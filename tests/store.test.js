import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  localDateStr,
  parseLocalDateStr,
  migrateLegacyData,
  exportSnapshot,
  importSnapshot,
  EXPORT_SCHEMA_VERSION,
} from '../js/store.js';

describe('local date helpers (audit #4: fixes UTC toISOString dates)', () => {
  test('localDateStr formats using local components, not UTC', () => {
    // Sep 14 2026, 11pm local time. A UTC-based formatter (toISOString)
    // would roll this to 2026-09-15 for any timezone behind UTC.
    const d = new Date(2026, 8, 14, 23, 0, 0);
    assert.equal(localDateStr(d), '2026-09-14');
  });

  test('parseLocalDateStr round-trips with localDateStr', () => {
    const s = '2027-04-17'; // wedding date
    const d = parseLocalDateStr(s);
    assert.equal(d.getFullYear(), 2027);
    assert.equal(d.getMonth(), 3);
    assert.equal(d.getDate(), 17);
    assert.equal(localDateStr(d), s);
  });

  test('parseLocalDateStr returns null for malformed input', () => {
    assert.equal(parseLocalDateStr('not-a-date'), null);
  });
});

describe('migrateLegacyData', () => {
  // Fixture mimicking a real old-app localStorage snapshot.
  function fixture() {
    return {
      // Two sessions of Full Body A, per-set detail present.
      'log_A_2026-09-14': JSON.stringify({
        0: { // legacy_goblet_squat
          0: { weight: 35, reps: 12, ts: 1 },
          1: { weight: 35, reps: 12, ts: 2 },
        },
        1: { // legacy_db_bench_press
          0: { weight: 40, reps: 10, ts: 3 },
        },
      }),
      'log_A_2026-09-16': JSON.stringify({
        0: { 0: { weight: 40, reps: 10, ts: 4 } },
      }),
      // hist_ rollup for an exercise/date NOT present in any log_ key --
      // must be picked up by the fallback path.
      'hist_A_2': JSON.stringify([
        { date: '2026-09-10', weight: 20, reps: 12, sets: 3 }, // legacy_db_romanian_deadlift
      ]),
      // hist_ rollup that DOES overlap a log_ key date -- must be ignored
      // in favor of the richer per-set data (no duplicate).
      'hist_A_0': JSON.stringify([
        { date: '2026-09-14', weight: 35, reps: 12, sets: 2 },
      ]),
      forge_session_history: JSON.stringify([
        {
          workoutId: 'A', workoutTitle: 'Full Body A', tag: 'Phase 1 · Full body',
          date: '2026-09-14T12:00:00.000Z', elapsedSec: 1800, isCardio: false,
          totalSetsLogged: 3, exercisesCompleted: 2, prs: [], exSummary: [],
        },
      ]),
      forge_notes: JSON.stringify([
        { id: 1700000000000, text: 'Goblet squat feels awkward', category: 'exercise', date: '2026-09-01T10:00:00.000Z', workout: 'A' },
      ]),
      sessions: '12',
      streak: '3',
      lastDay: new Date(2026, 8, 16).toDateString(),
      forge_start_date: '2026-08-31',
    };
  }

  test('extracts per-set logs with stable legacy exercise ids, not array indices', () => {
    const { setLogs } = migrateLegacyData(fixture());
    const goblet = setLogs.filter(s => s.exerciseId === 'legacy_goblet_squat');
    assert.equal(goblet.length, 3); // 2 sets on the 14th + 1 set on the 16th
    assert.ok(goblet.every(s => s.sessionId === 'legacy_A'));
    assert.ok(goblet.every(s => s.source === 'legacy'));
    const bench = setLogs.find(s => s.exerciseId === 'legacy_db_bench_press');
    assert.equal(bench.weightLb, 40);
    assert.equal(bench.reps, 10);
  });

  test('hist_ fallback only fills in dates not already covered by log_ detail', () => {
    const { setLogs } = migrateLegacyData(fixture());
    // legacy_db_romanian_deadlift: only exists via hist_ fallback
    const rdl = setLogs.filter(s => s.exerciseId === 'legacy_db_romanian_deadlift');
    assert.equal(rdl.length, 1);
    assert.equal(rdl[0].source, 'legacy-hist-fallback');
    assert.equal(rdl[0].date, '2026-09-10');
    // legacy_goblet_squat 2026-09-14 already covered by log_ -- the
    // overlapping hist_A_0 entry for that date must NOT add a duplicate.
    const gobletOn14 = setLogs.filter(s => s.exerciseId === 'legacy_goblet_squat' && s.date === '2026-09-14');
    assert.equal(gobletOn14.length, 2); // the 2 real sets, not 3
    assert.ok(gobletOn14.every(s => s.source === 'legacy'));
  });

  test('migration is idempotent: running twice on the same raw data yields identical setLogs', () => {
    const a = migrateLegacyData(fixture());
    const b = migrateLegacyData(fixture());
    assert.deepEqual(a.setLogs, b.setLogs);
  });

  test('migrates session history, notes, and meta counters', () => {
    const { sessionHistory, notes, meta } = migrateLegacyData(fixture());
    assert.equal(sessionHistory.length, 1);
    assert.equal(sessionHistory[0].sessionId, 'legacy_A');
    assert.equal(sessionHistory[0].date, '2026-09-14');

    assert.equal(notes.length, 1);
    assert.equal(notes[0].text, 'Goblet squat feels awkward');

    assert.equal(meta.sessionsCompleted, 12);
    assert.equal(meta.streak, 3);
    assert.equal(meta.lastCompletedDay, '2026-09-16');
    assert.equal(meta.startDate, '2026-08-31');
    assert.equal(meta.migratedFromLegacy, true);
  });

  test('unknown legacy exercise indices are skipped with a warning, not thrown', () => {
    const raw = { 'log_A_2026-09-14': JSON.stringify({ 99: { 0: { weight: 10, reps: 10 } } }) };
    const { setLogs, warnings } = migrateLegacyData(raw);
    assert.equal(setLogs.length, 0);
    assert.ok(warnings.some(w => w.includes('Unknown legacy exercise')));
  });

  test('malformed JSON in a key is skipped with a warning, not thrown', () => {
    const raw = { 'log_A_2026-09-14': '{not json' };
    assert.doesNotThrow(() => migrateLegacyData(raw));
    const { warnings } = migrateLegacyData(raw);
    assert.ok(warnings.some(w => w.includes('Could not parse')));
  });

  test('empty/absent legacy keys produce empty (not crashing) results', () => {
    const result = migrateLegacyData({});
    assert.deepEqual(result.setLogs, []);
    assert.deepEqual(result.sessionHistory, []);
    assert.deepEqual(result.notes, []);
    assert.equal(result.meta.sessionsCompleted, 0);
    assert.equal(result.meta.migratedFromLegacy, true);
  });
});

describe('export / import round trip', () => {
  test('exportSnapshot then importSnapshot returns equivalent data', () => {
    const data = {
      setLogs: [{ id: 'a', date: '2026-09-14', sessionId: 'FBA', exerciseId: 'bb_back_squat', setIndex: 0, weightLb: 135, reps: 8, rir: 2, painFlag: false, note: '', source: 'v2' }],
      sessionHistory: [{ id: '2026-09-14_FBA', date: '2026-09-14', sessionId: 'FBA' }],
      notes: [{ id: '1', text: 'Felt strong today', category: 'general', date: '2026-09-14T10:00:00.000Z', workout: 'FBA' }],
      bodyLogs: [{ id: '2026-09-14', date: '2026-09-14', weightLb: 165 }],
      meta: { sessionsCompleted: 1, streak: 1, schemaVersion: 1 },
    };
    const json = exportSnapshot(data);
    const roundTripped = importSnapshot(json);
    assert.deepEqual(roundTripped.setLogs, data.setLogs);
    assert.deepEqual(roundTripped.sessionHistory, data.sessionHistory);
    assert.deepEqual(roundTripped.notes, data.notes);
    assert.deepEqual(roundTripped.bodyLogs, data.bodyLogs);
    assert.deepEqual(roundTripped.meta, data.meta);
  });

  test('exportSnapshot stamps the current schema version', () => {
    const json = exportSnapshot({});
    const parsed = JSON.parse(json);
    assert.equal(parsed.schemaVersion, EXPORT_SCHEMA_VERSION);
    assert.ok(parsed.exportedAt);
  });

  test('importSnapshot rejects invalid JSON', () => {
    assert.throws(() => importSnapshot('{not json'), /not valid JSON/);
  });

  test('importSnapshot rejects an unsupported schema version', () => {
    const json = JSON.stringify({ schemaVersion: 999, setLogs: [], sessionHistory: [], notes: [], bodyLogs: [], meta: {} });
    assert.throws(() => importSnapshot(json), /unsupported schemaVersion/);
  });

  test('importSnapshot rejects a missing array field', () => {
    const json = JSON.stringify({ schemaVersion: EXPORT_SCHEMA_VERSION, setLogs: 'not-an-array', sessionHistory: [], notes: [], bodyLogs: [], meta: {} });
    assert.throws(() => importSnapshot(json), /setLogs is not an array/);
  });

  test('importSnapshot rejects a missing meta object', () => {
    const json = JSON.stringify({ schemaVersion: EXPORT_SCHEMA_VERSION, setLogs: [], sessionHistory: [], notes: [], bodyLogs: [] });
    assert.throws(() => importSnapshot(json), /meta is not an object/);
  });
});
