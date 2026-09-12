// js/plan-screen.js
// Phase 2: renders the Plan screen (#screen-plan) from data/program.json
// using the program engine (js/program.js) and volume math (js/volume.js).
// Owns week navigation, the volume dashboard, and the manual week editor
// (swap / sets / reps / move day) with per-week undo, persisted through
// js/store.js.
//
// This is scoped to the Plan screen only -- the rest of the app (home,
// workout logging, notes, overload) still runs on the legacy inline script
// in index.html and is untouched here (Phase 3 territory). Expect this file
// to be absorbed into a general js/app.js router once more screens migrate.

import { Store, localDateStr } from './store.js';
import { resolveWeek, weekNumberForDate } from './program.js';
import { computeVolume, flagVolumeOutOfRange } from './volume.js';

const DAY_LABELS = { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' };
const DAY_ORDER = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function fmtMuscle(m) {
  return m.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

class PlanScreen {
  constructor() {
    this.program = null;
    this.store = null;
    this.viewingWeek = 1;
    this.currentWeek = 1;
    this.exerciseById = new Map();
    // Renders are serialized through this chain so rapid clicks (week nav,
    // repeated edits) can never interleave two in-flight async renders and
    // clobber each other's DOM writes.
    this._renderChain = Promise.resolve();
  }

  _queueRender() {
    this._renderChain = this._renderChain.then(() => this.render());
    return this._renderChain;
  }

  async init() {
    try {
      const res = await fetch('data/program.json');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      this.program = await res.json();
    } catch (err) {
      this._renderFatalError(`Could not load the program (data/program.json): ${err.message}`);
      return;
    }
    this.exerciseById = new Map(this.program.exerciseLibrary.map(e => [e.id, e]));

    try {
      this.store = new Store();
      await this.store.open();
      await this.store.runMigrationIfNeeded();
    } catch (err) {
      // IndexedDB unavailable (e.g. private browsing) -- editing/undo won't
      // persist, but the plan is still readable. Fail soft, not silent.
      console.warn('Forge: IndexedDB unavailable, week edits will not persist this session.', err);
      this.store = null;
    }

    this.currentWeek = weekNumberForDate(this.program, new Date());
    this.viewingWeek = this.currentWeek;

    document.getElementById('planTotalWeeks').textContent = this.program.meta.totalWeeks;
    document.getElementById('planWeekPrev').addEventListener('click', () => this.changeWeek(-1));
    document.getElementById('planWeekNext').addEventListener('click', () => this.changeWeek(1));
    document.getElementById('planUndoBtn').addEventListener('click', () => this.undo());

    await this._queueRender();
  }

  async changeWeek(delta) {
    const next = this.viewingWeek + delta;
    if (next < 1 || next > this.program.meta.totalWeeks) return;
    this.viewingWeek = next;
    await this._queueRender();
  }

  async undo() {
    if (!this.store) return;
    const removed = await this.store.undoLastOverride(this.viewingWeek);
    if (!removed) return;
    await this._queueRender();
  }

  async _overridesForViewingWeek() {
    if (!this.store) return [];
    return this.store.getOverridesForWeek(this.viewingWeek);
  }

  // Accepts one change or an array -- multiple related changes (e.g. sets
  // and reps saved from the same click) become ONE override record, so one
  // "Save" click undoes as one unit.
  async _addOverride(sessionId, changeOrChanges) {
    if (!this.store) {
      alert('Changes cannot be saved right now (storage unavailable), so this edit was not applied.');
      return;
    }
    const changes = (Array.isArray(changeOrChanges) ? changeOrChanges : [changeOrChanges])
      .map(c => ({ ...c, sessionId }));
    await this.store.addOverride({
      weekNumber: this.viewingWeek,
      changes,
      createdBy: 'user',
      approvedAt: new Date().toISOString(),
      rationale: 'Manual edit from the Plan screen.',
    });
    await this._queueRender();
  }

  async render() {
    const overrides = await this._overridesForViewingWeek();
    let resolved;
    try {
      resolved = resolveWeek(this.program, this.viewingWeek, overrides);
    } catch (err) {
      this._renderFatalError(err.message);
      return;
    }
    document.getElementById('planViewingWeek').textContent = this.viewingWeek;
    document.getElementById('planWeekPrev').disabled = this.viewingWeek <= 1;
    document.getElementById('planWeekNext').disabled = this.viewingWeek >= this.program.meta.totalWeeks;

    this._renderBanner(resolved);
    this._renderSessions(resolved);
    this._renderVolume(resolved);
    this._renderEditor(resolved);
  }

  _renderFatalError(message) {
    const el = document.getElementById('planSessions');
    if (el) el.innerHTML = `<div class="no-history">${escapeHtml(message)}</div>`;
  }

  _renderBanner(resolved) {
    const isCurrent = resolved.weekNumber === this.currentWeek;
    document.getElementById('planBlockTag').textContent = resolved.block.name + (isCurrent ? ' · current week' : '');
    document.getElementById('planWeekTitle').textContent = `WEEK ${resolved.weekNumber}`;
    const parts = [`RIR ${resolved.block.rir}`, resolved.block.nutritionPhase.replace(/_/g, ' ')];
    document.getElementById('planWeekMeta').textContent = parts.join(' · ') + (resolved.block.note ? ` — ${resolved.block.note}` : '');
  }

  _renderSessions(resolved) {
    const html = resolved.sessions.map(session => {
      const day = DAY_ORDER.find(d => resolved.schedule[d] === session.id);
      const dayLabel = day ? DAY_LABELS[day] : 'unscheduled this week';
      const rows = session.blocks.map(b => {
        const ex = this.exerciseById.get(b.exerciseId);
        const name = ex ? ex.name : b.exerciseId;
        const badge = b.overridden ? ' <span class="lift-delta up">edited</span>' : '';
        return `<div class="drawer-ex">
          <div class="drawer-ex-top">
            <div class="drawer-ex-name">${escapeHtml(name)}${badge}</div>
            <div class="drawer-ex-sets">${b.sets} &times; ${b.repMin}-${b.repMax}</div>
          </div>
          <div class="drawer-ex-tip">RIR ${escapeHtml(String(b.rir))} &middot; rest ${Math.round(b.restSec / 60 * 10) / 10} min</div>
        </div>`;
      }).join('');
      return `<div class="lift-history-card">
        <div class="lift-history-name">${escapeHtml(session.title)} <span style="color:var(--muted);font-weight:400">(${dayLabel} &middot; ~${session.estMinutes} min)</span></div>
        <div>${rows}</div>
      </div>`;
    }).join('');
    document.getElementById('planSessions').innerHTML = html;
  }

  _renderVolume(resolved) {
    const volume = computeVolume(this.program, resolved);
    const flags = flagVolumeOutOfRange(this.program, volume);
    const colorFor = flag => flag === 'over' ? 'var(--danger)' : flag === 'under' ? 'var(--phase3)' : 'var(--accent2)';
    const max = this.program.guardrails.maxDirectSetsPerMusclePerWeek;
    const html = this.program.muscles.map(muscle => {
      const v = volume[muscle];
      const pct = Math.min(100, Math.round((v.direct / max) * 100));
      const color = colorFor(flags[muscle]);
      const fractionalNote = v.fractional > 0 ? ` (+${v.fractional} indirect)` : '';
      return `<div class="phase-prog-row">
        <div class="phase-prog-top">
          <span class="phase-prog-name">${fmtMuscle(muscle)}</span>
          <span class="phase-prog-status">${v.direct} sets${fractionalNote}</span>
        </div>
        <div class="phase-prog-bar"><div class="phase-prog-fill" style="width:${pct}%;background:${color}"></div></div>
      </div>`;
    }).join('');
    document.getElementById('planVolume').innerHTML = html;
  }

  _renderEditor(resolved) {
    const exerciseOptions = this.program.exerciseLibrary
      .map(e => `<option value="${e.id}">${escapeHtml(e.name)}</option>`).join('');

    const sessionEditors = resolved.sessions.map(session => {
      const rows = session.blocks.map(b => {
        const ex = this.exerciseById.get(b.exerciseId);
        const name = ex ? ex.name : b.exerciseId;
        const rowId = `edit_${session.id}_${b.exerciseId}`;
        return `<div class="drawer-ex">
          <div class="drawer-ex-name" style="margin-bottom:8px">${escapeHtml(name)}</div>
          <div class="set-row" style="grid-template-columns:1fr 1fr 1fr;margin-bottom:6px">
            <div class="set-input-wrap"><span class="set-input-label">Sets</span>
              <input class="set-input" type="number" min="1" max="10" id="${rowId}_sets" value="${b.sets}"></div>
            <div class="set-input-wrap"><span class="set-input-label">Rep min</span>
              <input class="set-input" type="number" min="1" max="30" id="${rowId}_repMin" value="${b.repMin}"></div>
            <div class="set-input-wrap"><span class="set-input-label">Rep max</span>
              <input class="set-input" type="number" min="1" max="30" id="${rowId}_repMax" value="${b.repMax}"></div>
          </div>
          <button class="notes-copy-btn" style="margin-top:0;margin-bottom:6px" data-action="save-sets-reps" data-session="${session.id}" data-exercise="${b.exerciseId}" data-row="${rowId}">Save sets/reps for this week</button>
          <div style="display:flex;gap:6px;align-items:center">
            <select class="set-input" style="text-align:left" id="${rowId}_swap">${exerciseOptions}</select>
            <button class="notes-copy-btn" style="width:auto;padding:8px 12px;margin-top:0" data-action="swap" data-session="${session.id}" data-exercise="${b.exerciseId}" data-row="${rowId}">Swap</button>
          </div>
        </div>`;
      }).join('');
      return `<div class="lift-history-card"><div class="lift-history-name">${escapeHtml(session.title)}</div>${rows}</div>`;
    }).join('');

    const dayOptions = ['rest', 'cardio_or_basketball', ...resolved.sessions.map(s => s.id)];
    const dayLabel = id => id === 'rest' ? 'Rest' : id === 'cardio_or_basketball' ? 'Cardio or basketball' : (this.program.sessions.find(s => s.id === id)?.title || id);
    const scheduleRow = DAY_ORDER.map(day => {
      const current = resolved.schedule[day];
      const options = dayOptions.map(id => `<option value="${id}" ${id === current ? 'selected' : ''}>${escapeHtml(dayLabel(id))}</option>`).join('');
      return `<div class="set-input-wrap"><span class="set-input-label">${DAY_LABELS[day]}</span>
        <select class="set-input" style="text-align:left" id="day_${day}">${options}</select></div>`;
    }).join('');

    document.getElementById('planEditor').innerHTML = `
      <div class="lift-history-card">
        <div class="lift-history-name">Move sessions to different days (this week only)</div>
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px">${scheduleRow}</div>
        <button class="notes-save-btn" data-action="save-schedule" style="margin-top:12px">Save day changes for week ${resolved.weekNumber}</button>
      </div>
      ${sessionEditors}
    `;

    document.getElementById('planEditor').querySelectorAll('[data-action="save-sets-reps"]').forEach(btn => {
      btn.addEventListener('click', () => {
        const { session, exercise, row } = btn.dataset;
        const sets = parseInt(document.getElementById(`${row}_sets`).value, 10);
        const repMin = parseInt(document.getElementById(`${row}_repMin`).value, 10);
        const repMax = parseInt(document.getElementById(`${row}_repMax`).value, 10);
        if (!sets || sets < 1 || !repMin || !repMax || repMin > repMax) {
          alert('Enter a valid sets count and rep range (min <= max) before saving.');
          return;
        }
        this._addOverride(session, [
          { op: 'set_sets', exerciseId: exercise, fields: { sets } },
          { op: 'set_reps', exerciseId: exercise, fields: { repMin, repMax } },
        ]);
      });
    });

    document.getElementById('planEditor').querySelectorAll('[data-action="swap"]').forEach(btn => {
      btn.addEventListener('click', () => {
        const { session, exercise, row } = btn.dataset;
        const newExerciseId = document.getElementById(`${row}_swap`).value;
        if (newExerciseId === exercise) return;
        this._addOverride(session, { op: 'swap_exercise', exerciseId: exercise, fields: { newExerciseId } });
      });
    });

    const saveScheduleBtn = document.getElementById('planEditor').querySelector('[data-action="save-schedule"]');
    saveScheduleBtn.addEventListener('click', async () => {
      const changedDays = DAY_ORDER.filter(day => document.getElementById(`day_${day}`).value !== resolved.schedule[day]);
      if (changedDays.length === 0) return;
      if (!this.store) { alert('Changes cannot be saved right now (storage unavailable).'); return; }
      await this.store.addOverride({
        weekNumber: this.viewingWeek,
        changes: changedDays.map(day => ({ op: 'move_day', fields: { day, sessionId: document.getElementById(`day_${day}`).value } })),
        createdBy: 'user',
        approvedAt: new Date().toISOString(),
        rationale: 'Manual day move from the Plan screen.',
      });
      await this._queueRender();
    });
  }
}

const planScreen = new PlanScreen();
planScreen.init();

// Re-render whenever the user navigates to the Plan tab, so edits made
// elsewhere (or the current-week banner) stay fresh without a full reload.
document.getElementById('nav-plan')?.addEventListener('click', () => {
  if (planScreen.program) planScreen._queueRender();
});
