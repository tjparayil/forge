// js/store.js
// IndexedDB-backed store for Forge v2, plus a migration path from the old
// single-file app's localStorage schema. Plain ES module, no dependencies.
//
// Design note: the pure functions below (localDateStr, migrateLegacyData,
// exportSnapshot, importSnapshot) take their inputs as plain values/objects
// instead of reading localStorage/indexedDB directly, so they can be unit
// tested with `node --test` without a browser. The Store class is a thin
// IndexedDB wrapper around them and is exercised manually in the browser
// (Node has no built-in indexedDB) -- see tests/store.test.js for what is
// and isn't covered.

// ---------- Local date helpers (fixes audit #4: UTC dates via toISOString) ----------

/** Format a Date as YYYY-MM-DD using LOCAL time, not UTC. */
export function localDateStr(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Parse a YYYY-MM-DD string as a LOCAL midnight Date, not UTC. */
export function parseLocalDateStr(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '');
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

// ---------- Legacy exercise map ----------
// Maps the OLD hardcoded workout id + exercise array index (from the
// single-file app's DATA.workouts) to a stable legacy exercise id + display
// name. These are intentionally separate from the new 31-week program's
// exercise library (data/program.json) -- the old app's exercises (goblet
// squat, DB bench, etc.) are different movements than the new barbell-based
// program, so old logs get their own identity instead of being remapped
// onto a same-slot-but-different new exercise.
export const LEGACY_EXERCISE_MAP = {
  A: [
    { id: 'legacy_goblet_squat', name: 'Goblet squat' },
    { id: 'legacy_db_bench_press', name: 'Dumbbell bench press' },
    { id: 'legacy_db_romanian_deadlift', name: 'Dumbbell Romanian deadlift' },
    { id: 'legacy_db_bent_over_row', name: 'Dumbbell bent-over row' },
    { id: 'legacy_db_shoulder_press', name: 'Dumbbell shoulder press' },
    { id: 'legacy_plank_hold', name: 'Plank hold' },
  ],
  B: [
    { id: 'legacy_reverse_lunge', name: 'Reverse lunge' },
    { id: 'legacy_pushups', name: 'Push-ups' },
    { id: 'legacy_kettlebell_swing', name: 'Kettlebell swing' },
    { id: 'legacy_db_single_arm_row', name: 'DB single-arm row' },
    { id: 'legacy_db_lateral_raise', name: 'DB lateral raise' },
    { id: 'legacy_dead_bug', name: 'Dead bug' },
  ],
  C: [
    { id: 'legacy_db_sumo_squat', name: 'DB sumo squat' },
    { id: 'legacy_db_incline_press', name: 'DB incline press' },
    { id: 'legacy_db_stiff_leg_deadlift', name: 'DB stiff-leg deadlift' },
    { id: 'legacy_db_chest_supported_row', name: 'DB chest-supported row' },
    { id: 'legacy_kb_halo', name: 'KB halo' },
    { id: 'legacy_side_plank', name: 'Side plank' },
  ],
  CARDIO: [
    { id: 'legacy_cardio_steady_state', name: 'Brisk walk, light jog, or cycling' },
    { id: 'legacy_cardio_target_hr', name: 'Target heart rate' },
  ],
};

function legacyExercise(workoutId, exIdx) {
  const list = LEGACY_EXERCISE_MAP[workoutId];
  if (!list) return null;
  return list[exIdx] || null;
}

// ---------- Pure migration logic ----------

const LOG_KEY_RE = /^log_(.+)_(\d{4}-\d{2}-\d{2})$/;
const HIST_KEY_RE = /^hist_(.+)_(\d+)$/;

/**
 * Transform a flat { key: valueString } snapshot of the OLD localStorage
 * schema into the new store's shape. Pure function: no I/O, so it can be
 * unit tested with a plain fixture object standing in for localStorage.
 *
 * Returns { setLogs, sessionHistory, notes, meta, warnings }.
 */
export function migrateLegacyData(raw) {
  const warnings = [];
  const setLogs = [];
  const setLogKeys = new Set(); // dedupe key: date|sessionId|exerciseId|setIndex

  function pushSetLog(entry) {
    const key = `${entry.date}|${entry.sessionId}|${entry.exerciseId}|${entry.setIndex}`;
    if (setLogKeys.has(key)) return;
    setLogKeys.add(key);
    setLogs.push({ id: key, ...entry });
  }

  // 1. Per-set detail from log_<workoutId>_<date> keys (richest source: has
  //    weight, reps, and timestamp for every logged set).
  const coveredDates = new Set(); // `${workoutId}|${date}` already has per-set detail
  for (const [key, value] of Object.entries(raw)) {
    const m = LOG_KEY_RE.exec(key);
    if (!m) continue;
    const [, workoutId, dateStr] = m;
    let log;
    try { log = JSON.parse(value); } catch { warnings.push(`Could not parse ${key}`); continue; }
    let sawAny = false;
    for (const [exIdxStr, sets] of Object.entries(log || {})) {
      const ex = legacyExercise(workoutId, Number(exIdxStr));
      if (!ex) { warnings.push(`Unknown legacy exercise ${workoutId}[${exIdxStr}] in ${key}`); continue; }
      for (const [setIdxStr, s] of Object.entries(sets || {})) {
        if (!s || !(s.weight > 0) || !(s.reps > 0)) continue;
        sawAny = true;
        pushSetLog({
          date: dateStr,
          sessionId: `legacy_${workoutId}`,
          exerciseId: ex.id,
          setIndex: Number(setIdxStr),
          weightLb: s.weight,
          reps: s.reps,
          rir: null,
          painFlag: false,
          note: '',
          source: 'legacy',
          ts: s.ts || null,
        });
      }
    }
    if (sawAny) coveredDates.add(`${workoutId}|${dateStr}`);
  }

  // 2. Fallback from hist_<workoutId>_<exIdx> summaries, for any
  //    workout/date combo NOT already covered by per-set detail above.
  //    Defensive: covers the case where a log_ key was cleared but the
  //    hist_ rollup survived, so nothing gets silently dropped.
  for (const [key, value] of Object.entries(raw)) {
    const m = HIST_KEY_RE.exec(key);
    if (!m) continue;
    const [, workoutId, exIdxStr] = m;
    const ex = legacyExercise(workoutId, Number(exIdxStr));
    if (!ex) { warnings.push(`Unknown legacy exercise ${workoutId}[${exIdxStr}] in ${key}`); continue; }
    let hist;
    try { hist = JSON.parse(value); } catch { warnings.push(`Could not parse ${key}`); continue; }
    for (const entry of hist || []) {
      if (!entry || !entry.date) continue;
      if (coveredDates.has(`${workoutId}|${entry.date}`)) continue;
      pushSetLog({
        date: entry.date,
        sessionId: `legacy_${workoutId}`,
        exerciseId: ex.id,
        setIndex: 0,
        weightLb: entry.weight,
        reps: entry.reps,
        rir: null,
        painFlag: false,
        note: 'Reconstructed from legacy summary history; per-set detail unavailable.',
        source: 'legacy-hist-fallback',
        ts: null,
      });
    }
  }

  // 3. Session history (already well-shaped in the old app).
  const sessionHistory = [];
  try {
    const old = JSON.parse(raw.forge_session_history || '[]');
    for (const s of old) {
      const dateStr = (s.date || '').slice(0, 10);
      sessionHistory.push({
        id: `${dateStr}_${s.workoutId || 'unknown'}`,
        date: dateStr,
        sessionId: s.workoutId ? `legacy_${s.workoutId}` : 'legacy_unknown',
        title: s.workoutTitle || '',
        tag: s.tag || '',
        elapsedSec: s.elapsedSec || 0,
        isCardio: !!s.isCardio,
        totalSetsLogged: s.totalSetsLogged || 0,
        exercisesCompleted: s.exercisesCompleted || 0,
        prs: s.prs || [],
        exSummary: s.exSummary || [],
        source: 'legacy',
      });
    }
  } catch { warnings.push('Could not parse forge_session_history'); }

  // 4. Notes (already well-shaped: id, text, category, date, workout).
  const notes = [];
  try {
    const old = JSON.parse(raw.forge_notes || '[]');
    for (const n of old) {
      if (n && n.id != null) {
        notes.push({
          id: String(n.id),
          text: n.text || '',
          category: n.category || 'general',
          date: n.date || null,
          workout: n.workout || null,
        });
      }
    }
  } catch { warnings.push('Could not parse forge_notes'); }

  // 5. Meta (counters + start date).
  let lastCompletedDay = null;
  if (raw.lastDay) {
    const d = new Date(raw.lastDay); // old format: Date.prototype.toDateString()
    if (!isNaN(d)) lastCompletedDay = localDateStr(d);
    else warnings.push(`Could not parse lastDay: ${raw.lastDay}`);
  }
  const meta = {
    sessionsCompleted: parseInt(raw.sessions || '0', 10) || 0,
    streak: parseInt(raw.streak || '0', 10) || 0,
    lastCompletedDay,
    startDate: raw.forge_start_date || null,
    schemaVersion: 1,
    migratedAt: new Date().toISOString(),
    migratedFromLegacy: true,
  };

  return { setLogs, sessionHistory, notes, meta, warnings };
}

// ---------- Export / import (JSON round trip) ----------

export const EXPORT_SCHEMA_VERSION = 1;

export function exportSnapshot(data) {
  return JSON.stringify({
    schemaVersion: EXPORT_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    setLogs: data.setLogs || [],
    sessionHistory: data.sessionHistory || [],
    notes: data.notes || [],
    bodyLogs: data.bodyLogs || [],
    meta: data.meta || {},
  }, null, 2);
}

export function importSnapshot(json) {
  let parsed;
  try { parsed = JSON.parse(json); } catch { throw new Error('Import failed: not valid JSON'); }
  if (!parsed || typeof parsed !== 'object') throw new Error('Import failed: not an object');
  if (parsed.schemaVersion !== EXPORT_SCHEMA_VERSION) {
    throw new Error(`Import failed: unsupported schemaVersion ${parsed.schemaVersion}`);
  }
  for (const field of ['setLogs', 'sessionHistory', 'notes', 'bodyLogs']) {
    if (!Array.isArray(parsed[field])) throw new Error(`Import failed: ${field} is not an array`);
  }
  if (!parsed.meta || typeof parsed.meta !== 'object') throw new Error('Import failed: meta is not an object');
  return {
    setLogs: parsed.setLogs,
    sessionHistory: parsed.sessionHistory,
    notes: parsed.notes,
    bodyLogs: parsed.bodyLogs,
    meta: parsed.meta,
  };
}

// ---------- IndexedDB-backed Store ----------
// Browser only. Node has no built-in indexedDB, so this class is not
// exercised by `node --test` -- only the pure functions above are. Verify
// this manually in the browser preview before Phase 2 wires it into the UI.

const DB_NAME = 'forge-v2';
const DB_VERSION = 2;
const RECORD_STORES = ['setLogs', 'sessionHistory', 'notes', 'bodyLogs', 'weekOverrides'];

export class Store {
  constructor(idbFactory = (typeof indexedDB !== 'undefined' ? indexedDB : null)) {
    this.idb = idbFactory;
    this.db = null;
  }

  open() {
    if (!this.idb) return Promise.reject(new Error('IndexedDB is not available in this environment'));
    return new Promise((resolve, reject) => {
      const req = this.idb.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        for (const name of RECORD_STORES) {
          if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
      };
      req.onsuccess = () => { this.db = req.result; resolve(this.db); };
      req.onerror = () => reject(req.error);
    });
  }

  getAll(storeName) {
    return new Promise((resolve, reject) => {
      const req = this.db.transaction(storeName, 'readonly').objectStore(storeName).getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  putAll(storeName, rows) {
    if (!rows || rows.length === 0) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      rows.forEach(r => store.put(r));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  deleteRecord(storeName, id) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(storeName, 'readwrite');
      tx.objectStore(storeName).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  /** All week-override records for one week, oldest first (application order). */
  async getOverridesForWeek(weekNumber) {
    const all = await this.getAll('weekOverrides');
    return all.filter(o => o.weekNumber === weekNumber).sort((a, b) => a.appliedAt.localeCompare(b.appliedAt));
  }

  /** Record one approved override (a manual edit now; an approved AI proposal later). */
  addOverride(record) {
    const withId = { id: `${record.weekNumber}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, appliedAt: new Date().toISOString(), ...record };
    return this.putAll('weekOverrides', [withId]).then(() => withId);
  }

  /** Undo: remove the most recently applied override for a given week. Scoped to that week only. */
  async undoLastOverride(weekNumber) {
    const overrides = await this.getOverridesForWeek(weekNumber);
    if (overrides.length === 0) return null;
    const last = overrides[overrides.length - 1];
    await this.deleteRecord('weekOverrides', last.id);
    return last;
  }

  async getMeta() {
    const rows = await this.getAll('meta');
    const out = {};
    for (const r of rows) out[r.key] = r.value;
    return out;
  }

  putMeta(meta) {
    return this.putAll('meta', Object.entries(meta).map(([key, value]) => ({ key, value })));
  }

  /**
   * Reads the OLD localStorage keys, migrates them, and writes into
   * IndexedDB. Safe to call more than once: it no-ops if meta.migratedFromLegacy
   * is already set, and setLog/sessionHistory ids are deterministic so a
   * re-run (if that flag were ever missing) would overwrite, not duplicate.
   */
  async runMigrationIfNeeded(localStorageRef = (typeof localStorage !== 'undefined' ? localStorage : null)) {
    const existingMeta = await this.getMeta();
    if (existingMeta.migratedFromLegacy) return { skipped: true };
    if (!localStorageRef) return { skipped: true, reason: 'no localStorage' };

    const raw = {};
    for (let i = 0; i < localStorageRef.length; i++) {
      const key = localStorageRef.key(i);
      raw[key] = localStorageRef.getItem(key);
    }
    const result = migrateLegacyData(raw);
    await this.putAll('setLogs', result.setLogs);
    await this.putAll('sessionHistory', result.sessionHistory);
    await this.putAll('notes', result.notes);
    await this.putMeta(result.meta);
    return { skipped: false, ...result };
  }

  async exportAll() {
    const [setLogs, sessionHistory, notes, bodyLogs, meta] = await Promise.all([
      this.getAll('setLogs'), this.getAll('sessionHistory'), this.getAll('notes'),
      this.getAll('bodyLogs'), this.getMeta(),
    ]);
    return exportSnapshot({ setLogs, sessionHistory, notes, bodyLogs, meta });
  }

  async importAll(json) {
    const data = importSnapshot(json);
    await this.putAll('setLogs', data.setLogs);
    await this.putAll('sessionHistory', data.sessionHistory);
    await this.putAll('notes', data.notes);
    await this.putAll('bodyLogs', data.bodyLogs);
    await this.putMeta(data.meta);
    return data;
  }
}
