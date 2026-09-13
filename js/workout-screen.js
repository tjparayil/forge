// js/workout-screen.js
// Phase 3: renders the Home, Workout, and Overload (progressive overload)
// screens from data/program.json + the IndexedDB store, replacing the old
// hardcoded DATA.workouts single-file app. Ports every existing live
// feature (per-set rest timers with haptics, workout elapsed timer, cardio
// timer, post-workout summary, session history) onto stable exercise IDs
// instead of array indices (audit #2), local dates instead of UTC (audit
// #4), and fixes the session double-count (#7) and rest-day streak (#6)
// bugs. Adds RIR and a pain flag per set, and progression-based targets.
//
// Bridges a few entry points onto `window.ForgeWorkout` because the static
// HTML shell (and index.html's remaining legacy script) still call these by
// name from onclick="" attributes -- see index.html's <script> for
// showScreen(), which calls into this bridge on tab switches.
//
// Phase 5 adds the body log, weight trend chart, nutrition target display,
// and wedding countdown to this same Progress screen (renderOverload()).

import { Store, localDateStr, parseLocalDateStr } from './store.js';
import { resolveWeek, weekNumberForDate } from './program.js';
import { computeTarget } from './progression.js';
import { computeStreak, sessionsCompletedCount } from './stats.js';
import { computeRollingAverage, computeTargetBand, daysUntilEvent } from './nutrition.js';
import { escapeHtml, DAY_ORDER, DAY_LABELS, DAY_FULL, mondayIndexOf, dayKeyOf, dateForWeekdayIndex } from './util.js';

const EQUIPMENT_LABEL = { barbell: 'Barbell', dumbbell: 'Dumbbells', cable: 'Cable', machine: 'Machine', bodyweight: 'Bodyweight' };
const EQUIPMENT_CLASS = { barbell: 'eq-barbell', dumbbell: 'eq-db', cable: 'eq-cable', machine: 'eq-machine', bodyweight: 'eq-bw' };
const NON_LIFT_LABEL = { rest: 'Rest', cardio_or_basketball: 'Cardio' };

class WorkoutApp {
  constructor() {
    this.program = null;
    this.store = null;
    this.currentWeek = 1;
    this.resolvedWeek = null;
    this.exerciseById = new Map();
    this.sessionHistory = [];
    this.setLogs = [];
    this.bodyLogs = [];

    // Ephemeral UI/session state (not persisted).
    this.activeSessionId = null;   // e.g. 'FBA', 'cardio_or_basketball', 'rest'
    this.activeDate = null;        // local YYYY-MM-DD the active session is logged against
    this.completedExercises = new Set();
    this.workoutStartTime = null;
    this.workoutElapsedInterval = null;
    this.inlineRestIntervals = {};
    this.cardio = { interval: null, remaining: 0, total: 0, running: false };
  }

  async init() {
    try {
      const res = await fetch('data/program.json');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      this.program = await res.json();
    } catch (err) {
      console.error('Forge: could not load data/program.json', err);
      return;
    }
    this.exerciseById = new Map(this.program.exerciseLibrary.map(e => [e.id, e]));

    try {
      this.store = new Store();
      await this.store.open();
      await this.store.runMigrationIfNeeded();
    } catch (err) {
      console.warn('Forge: IndexedDB unavailable, logging will not persist this session.', err);
      this.store = null;
    }

    await this.refreshWeek();
    await this.refreshHistory();
    this.renderHome();
    this._wireBodyLogForm();
    this._renderWeddingCountdown();
  }

  async refreshWeek() {
    this.currentWeek = weekNumberForDate(this.program, new Date());
    const overrides = this.store ? await this.store.getOverridesForWeek(this.currentWeek) : [];
    this.resolvedWeek = resolveWeek(this.program, this.currentWeek, overrides);
  }

  async refreshHistory() {
    this.sessionHistory = this.store ? await this.store.getAll('sessionHistory') : [];
    this.setLogs = this.store ? await this.store.getAll('setLogs') : [];
    this.bodyLogs = this.store ? await this.store.getAll('bodyLogs') : [];
  }

  getSession(sessionId) {
    return this.resolvedWeek.sessions.find(s => s.id === sessionId) || null;
  }

  todaySessionId() {
    return this.resolvedWeek.schedule[dayKeyOf(new Date())];
  }

  isLiftSession(sessionId) {
    return this.resolvedWeek.sessions.some(s => s.id === sessionId);
  }

  // ---------- Home screen ----------

  renderHome() {
    this.renderBlockBanner();
    this.renderWeekGrid();
    this.renderTodayCard();
    this.renderStats();
  }

  renderBlockBanner() {
    const block = this.resolvedWeek.block;
    const weeksInBlock = this.program.blocks.find(b => b.id === block.id)?.weeks || [];
    const first = weeksInBlock[0], last = weeksInBlock[weeksInBlock.length - 1];
    document.getElementById('blockBannerTag').textContent = block.name.toUpperCase();
    document.getElementById('blockBannerName').textContent = `Week ${this.currentWeek} of ${this.program.meta.totalWeeks} · View full plan ›`;
    document.getElementById('blockBannerWeeks').textContent = weeksInBlock.length > 1 ? `Weeks ${first}-${last}` : `Week ${first}`;
  }

  renderWeekGrid() {
    const grid = document.getElementById('weekGrid');
    if (!grid) return;
    const today = new Date();
    const todayIdx = mondayIndexOf(today);
    const completedDates = new Set(this.sessionHistory.map(s => s.date));
    const html = DAY_ORDER.map((dayKey, i) => {
      const sessionId = this.resolvedWeek.schedule[dayKey];
      const isLift = this.isLiftSession(sessionId);
      const typeClass = sessionId === 'rest' ? 'rest' : isLift ? 'lift' : 'cardio';
      const typeLabel = isLift ? 'Lift' : (NON_LIFT_LABEL[sessionId] || 'Rest');
      const dateStr = localDateStr(dateForWeekdayIndex(i, today));
      const completed = completedDates.has(dateStr) ? 'completed' : '';
      const todayClass = i === todayIdx ? 'today' : '';
      return `<div class="wday ${typeClass} ${todayClass} ${completed}" data-day="${i}" title="${DAY_FULL[dayKey]}">
        <div class="wd-name">${DAY_LABELS[dayKey][0]}</div>
        <div class="wd-dot"></div>
        <div class="wd-type">${typeLabel}</div>
      </div>`;
    }).join('');
    grid.innerHTML = html;
    grid.querySelectorAll('[data-day]').forEach(el => {
      el.addEventListener('click', () => this.openDayDrawer(parseInt(el.dataset.day, 10)));
    });
  }

  renderTodayCard() {
    const sessionId = this.todaySessionId();
    const titleEl = document.getElementById('todayTitle');
    const tagEl = document.getElementById('todayTag');
    const metaEl = document.getElementById('todayMeta');
    const previewEl = document.getElementById('todayPreview');
    const moreEl = document.getElementById('todayMore');
    const startBtn = document.querySelector('.start-btn');

    if (sessionId === 'rest') {
      titleEl.textContent = 'REST DAY';
      tagEl.textContent = 'Recovery';
      metaEl.textContent = 'Active rest or light stretching';
      previewEl.innerHTML = '<div style="font-size:13px;color:var(--muted);padding:8px 0">You’ve earned it. Light walk or stretching only.</div>';
      moreEl.textContent = '';
      startBtn.textContent = 'View recovery tips';
      return;
    }
    if (sessionId === 'cardio_or_basketball') {
      titleEl.textContent = 'CARDIO';
      tagEl.textContent = this.resolvedWeek.block.name;
      metaEl.textContent = '20-30 min · easy conversational pace';
      previewEl.innerHTML = '<div style="font-size:13px;color:var(--muted);padding:8px 0">Cycling, incline walk, running, or basketball -- your choice.</div>';
      moreEl.textContent = '';
      startBtn.textContent = 'Start cardio timer';
      return;
    }

    const session = this.getSession(sessionId);
    if (!session) { titleEl.textContent = 'NO SESSION'; return; }
    tagEl.textContent = `${this.resolvedWeek.block.name} · ${session.focus}`;
    titleEl.textContent = session.title.toUpperCase();
    metaEl.textContent = `~${session.estMinutes} min · ${session.blocks.length} exercises`;
    const preview = session.blocks.slice(0, 3);
    previewEl.innerHTML = preview.map(b => {
      const ex = this.exerciseById.get(b.exerciseId);
      return `<div class="today-ex"><span>${escapeHtml(ex ? ex.name : b.exerciseId)}</span><em>${b.sets} × ${b.repMin}-${b.repMax}</em></div>`;
    }).join('');
    const remaining = session.blocks.length - 3;
    moreEl.textContent = remaining > 0 ? `+${remaining} more exercises` : '';
    startBtn.textContent = 'Start session';
  }

  renderStats() {
    const streak = computeStreak(this.program, this.sessionHistory);
    const sessions = sessionsCompletedCount(this.sessionHistory);
    document.getElementById('statSessions').textContent = sessions;
    document.getElementById('statStreak').textContent = streak;
    document.getElementById('statWeek').textContent = this.currentWeek;
    document.getElementById('currentWeek').textContent = this.currentWeek;
    document.getElementById('totalWeeksBadge').textContent = this.program.meta.totalWeeks;
  }

  openToday() {
    this.loadSession(this.todaySessionId(), localDateStr(new Date()));
    window.showScreen('workout');
  }

  hasActiveSession() {
    return !!this.activeSessionId;
  }

  // ---------- Day drawer ----------

  openDayDrawer(dayIdx) {
    const dayKey = DAY_ORDER[dayIdx];
    const sessionId = this.resolvedWeek.schedule[dayKey];
    const today = new Date();
    const isToday = dayIdx === mondayIndexOf(today);
    const dateStr = localDateStr(dateForWeekdayIndex(dayIdx, today));
    const dayLabel = isToday ? 'Today' : DAY_FULL[dayKey];
    const completedSession = this.sessionHistory.find(s => s.date === dateStr);

    let html;
    if (completedSession) {
      html = this._renderCompletedSessionCard(completedSession, isToday, dayLabel, sessionId);
    } else if (sessionId === 'rest') {
      html = `<div class="drawer-header">
        <div class="drawer-day-tag">${escapeHtml(dayLabel)} · Recovery</div>
        <div class="drawer-title">REST DAY</div>
      </div>
      <div class="rest-day-card"><h3>Active recovery</h3><p>20-30 min easy walk or light cycling. Keep heart rate low.</p></div>
      <div class="rest-day-card"><h3>Nutrition reminder</h3><p>Hit your protein target even on rest days. Muscle repair peaks 24-48 hrs after training.</p></div>
      <div class="rest-day-card"><h3>Sleep</h3><p>Aim for 7-9 hours. Growth hormone peaks during deep sleep.</p></div>`;
    } else if (sessionId === 'cardio_or_basketball') {
      html = `<div class="drawer-header">
        <div class="drawer-day-tag">${escapeHtml(dayLabel)} · Cardio</div>
        <div class="drawer-title">CARDIO OR BASKETBALL</div>
      </div>
      <div class="rest-day-card"><h3>Easy pace</h3><p>Cycling, incline walk, running, or basketball. Conversational pace unless it's a game.</p></div>
      <button class="drawer-start-btn" data-start-session="${sessionId}" data-start-date="${dateStr}">Start cardio timer</button>`;
    } else {
      const session = this.getSession(sessionId);
      const exListHTML = session.blocks.map(b => {
        const ex = this.exerciseById.get(b.exerciseId);
        return `<div class="drawer-ex">
          <div class="drawer-ex-top">
            <div style="flex:1">
              <div class="drawer-ex-name">${escapeHtml(ex ? ex.name : b.exerciseId)}</div>
              <span class="drawer-eq ${EQUIPMENT_CLASS[ex?.equipment] || 'eq-bw'}">${EQUIPMENT_LABEL[ex?.equipment] || ''}</span>
            </div>
            <div class="drawer-ex-sets">${b.sets} × ${b.repMin}-${b.repMax}</div>
          </div>
        </div>`;
      }).join('');
      html = `<div class="drawer-header">
        <div class="drawer-day-tag">${escapeHtml(dayLabel)} · ${escapeHtml(session.focus)}</div>
        <div class="drawer-title">${escapeHtml(session.title.toUpperCase())}</div>
        <div class="drawer-meta"><span class="wmeta">~${session.estMinutes} min</span><span class="wmeta">RIR ${escapeHtml(this.resolvedWeek.block.rir)}</span></div>
      </div>
      <div class="drawer-warmup">
        <div class="drawer-warmup-label">Warm-up</div>
        <div class="drawer-warmup-text">${escapeHtml(session.warmup)}</div>
      </div>
      <div class="drawer-ex-label">Exercises · ${session.blocks.length} movements</div>
      ${exListHTML}
      <button class="drawer-start-btn" data-start-session="${sessionId}" data-start-date="${dateStr}">
        ${isToday ? 'Start this session' : 'Preview & start this session'}
      </button>`;
    }

    const content = document.getElementById('drawerContent');
    content.innerHTML = html;
    content.querySelectorAll('[data-start-session]').forEach(btn => {
      btn.addEventListener('click', () => {
        this.closeDrawer();
        this.loadSession(btn.dataset.startSession, btn.dataset.startDate);
        window.showScreen('workout');
      });
    });
    document.getElementById('drawerBackdrop').classList.add('show');
    requestAnimationFrame(() => document.getElementById('dayDrawer').classList.add('open'));
    document.querySelectorAll('.wday').forEach((el, i) => el.classList.toggle('selected', i === dayIdx));
  }

  _renderCompletedSessionCard(s, isToday, dayLabel, sessionId) {
    const elMin = Math.floor(s.elapsedSec / 60), elSec = s.elapsedSec % 60;
    const timeStr = s.elapsedSec > 0 ? `${elMin}:${String(elSec).padStart(2, '0')}` : '—';
    const statsHTML = s.isCardio
      ? `<div class="stat-row">
          <div class="stat-card"><div class="stat-num">${timeStr}</div><div class="stat-unit">Duration</div></div>
          <div class="stat-card"><div class="stat-num">✓</div><div class="stat-unit">Complete</div></div>
        </div>`
      : `<div class="stat-row">
          <div class="stat-card"><div class="stat-num">${timeStr}</div><div class="stat-unit">Duration</div></div>
          <div class="stat-card"><div class="stat-num">${s.totalSetsLogged}</div><div class="stat-unit">Sets logged</div></div>
          <div class="stat-card"><div class="stat-num">${s.exercisesCompleted}</div><div class="stat-unit">Exercises</div></div>
        </div>`;
    const prsHTML = s.prs && s.prs.length > 0
      ? `<div class="section-label" style="margin-top:14px">Weight PRs</div>
         ${s.prs.map(p => `<div class="drawer-ex" style="border-left:2px solid var(--accent)">
           <div class="drawer-ex-top"><div class="drawer-ex-name">${escapeHtml(p.name)}</div>
           <div class="drawer-ex-sets" style="color:var(--accent)">${p.prev}lbs → ${p.now}lbs</div></div>
         </div>`).join('')}` : '';
    const exHTML = !s.isCardio && s.exSummary
      ? `<div class="section-label" style="margin-top:14px">Exercise breakdown</div>
         ${s.exSummary.map(e => `<div class="drawer-ex">
           <div class="drawer-ex-top"><div class="drawer-ex-name">${escapeHtml(e.name)}</div>
           <div class="drawer-ex-sets">${e.sets > 0 ? `${e.sets} sets · ${e.best.weightLb}lbs × ${e.best.reps}` : 'Not logged'}</div></div>
         </div>`).join('')}` : '';
    const tag = isToday ? 'Completed today' : `Completed · ${dayLabel}`;
    const redoBtn = isToday ? `<button class="drawer-start-btn" style="background:var(--surface2);color:var(--muted);border:0.5px solid var(--border)" data-start-session="${sessionId}" data-start-date="${s.date}">Start another session</button>` : '';
    return `<div class="drawer-header">
      <div class="drawer-day-tag" style="color:var(--phase2)">${escapeHtml(tag)}</div>
      <div class="drawer-title">${escapeHtml(s.title.toUpperCase())}</div>
    </div>
    ${statsHTML}${prsHTML}${exHTML}${redoBtn}`;
  }

  closeDrawer() {
    document.getElementById('dayDrawer').classList.remove('open');
    document.getElementById('drawerBackdrop').classList.remove('show');
    document.querySelectorAll('.wday').forEach(el => el.classList.remove('selected'));
  }

  // ---------- Workout screen ----------

  loadSession(sessionId, dateStr) {
    this.activeSessionId = sessionId;
    this.activeDate = dateStr;
    this.completedExercises = new Set();
    this._startWorkoutTimer();

    document.getElementById('workoutTimer').style.display = 'flex';
    const bottomRestBtn = document.querySelector('.rest-timer-btn');

    if (sessionId === 'cardio_or_basketball') {
      document.getElementById('wPhaseTag').textContent = this.resolvedWeek.block.name;
      document.getElementById('wTitle').textContent = 'CARDIO';
      document.getElementById('wMeta').innerHTML = '';
      document.getElementById('wWarmup').textContent = '5 min easy pace is your warm-up.';
      if (bottomRestBtn) bottomRestBtn.style.display = 'none';
      this._renderCardioScreen();
      return;
    }
    if (bottomRestBtn) bottomRestBtn.style.display = '';

    const session = this.getSession(sessionId);
    if (!session) return;
    document.getElementById('wPhaseTag').textContent = `${this.resolvedWeek.block.name} · ${session.focus}`;
    document.getElementById('wTitle').textContent = session.title.toUpperCase();
    document.getElementById('wMeta').innerHTML = [`~${session.estMinutes} min`, `RIR ${this.resolvedWeek.block.rir}`, `${session.blocks.length} exercises`]
      .map(m => `<span class="wmeta">${escapeHtml(m)}</span>`).join('');
    document.getElementById('wWarmup').textContent = session.warmup;
    this._renderExerciseCards(session, dateStr);
  }

  _todayLogFor(sessionId, dateStr, exerciseId) {
    return this.setLogs.filter(l => l.sessionId === sessionId && l.date === dateStr && l.exerciseId === exerciseId);
  }

  _priorSessionsFor(exerciseId, excludeDate) {
    // Group this exercise's WORKING sets by date (excluding the active
    // date, so "last session" means the last completed one, not today's
    // in-progress log), sorted oldest first.
    const byDate = new Map();
    for (const log of this.setLogs) {
      if (log.exerciseId !== exerciseId || log.date === excludeDate) continue;
      if (!(log.weightLb > 0 && log.reps > 0)) continue;
      if (!byDate.has(log.date)) byDate.set(log.date, []);
      byDate.get(log.date).push({ weightLb: log.weightLb, reps: log.reps });
    }
    return [...byDate.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([, sets]) => sets);
  }

  _renderExerciseCards(session, dateStr) {
    const html = session.blocks.map((b, i) => {
      const ex = this.exerciseById.get(b.exerciseId) || { name: b.exerciseId, equipment: 'bodyweight', cues: {} };
      const cues = ex.cues || {};
      const setupHTML = (cues.setup || []).map(c => `<div class="cue-item"><div class="cue-dot setup"></div><span class="cue-text">${escapeHtml(c)}</span></div>`).join('');
      const moveHTML = (cues.move || []).map(c => `<div class="cue-item"><div class="cue-dot move"></div><span class="cue-text">${escapeHtml(c)}</span></div>`).join('');
      const avoidHTML = (cues.avoid || []).map(c => `<div class="cue-item"><div class="cue-dot avoid"></div><span class="cue-text">${escapeHtml(c)}</span></div>`).join('');
      const hasCues = setupHTML || moveHTML || avoidHTML;

      const priorSessions = this._priorSessionsFor(b.exerciseId, dateStr);
      const last = priorSessions.length ? priorSessions[priorSessions.length - 1] : null;
      const lastBest = last ? last.reduce((a, c) => (c.weightLb > a.weightLb ? c : a)) : null;
      const target = computeTarget(priorSessions, b);

      const todayLogs = this._todayLogFor(session.id, dateStr, b.exerciseId);
      const prevHTML = lastBest
        ? `<div class="prev-row"><span class="prev-label">Last session</span><span class="prev-val">${lastBest.weightLb}lbs × ${lastBest.reps} reps</span></div>`
        : '';
      const targetBadge = target
        ? `<span class="overload-badge ${target.stalled ? 'overload-same' : 'overload-up'}">${target.stalled ? 'Stalled: ' : 'Target: '}${target.weightLb}lbs × ${target.reps}</span>`
        : `<span class="overload-badge overload-new">First session — log your starting weight</span>`;

      const setsHTML = Array.from({ length: b.sets }, (_, si) => {
        const saved = todayLogs.find(l => l.setIndex === si);
        const isDone = !!(saved && saved.weightLb > 0 && saved.reps > 0);
        const wVal = saved ? saved.weightLb : (target ? target.weightLb : '');
        const rVal = saved ? saved.reps : (target ? target.reps : '');
        const rirVal = saved && saved.rir != null ? saved.rir : '';
        const painFlagged = !!(saved && saved.painFlag);
        const isLastSet = si === b.sets - 1;
        return `<div class="set-row" data-ex="${i}" data-set="${si}">
          <div class="set-num">S${si + 1}</div>
          <div class="set-input-wrap"><div class="set-input-label">lbs</div>
            <input class="set-input" type="number" inputmode="decimal" placeholder="${target ? target.weightLb : ''}" value="${wVal || ''}" data-field="weight"></div>
          <div class="set-input-wrap"><div class="set-input-label">Reps</div>
            <input class="set-input" type="number" inputmode="numeric" placeholder="${target ? target.reps : ''}" value="${rVal || ''}" data-field="reps"></div>
          <button class="set-done-btn ${isDone ? 'logged' : ''}" data-action="toggle-done">
            <svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>
          </button>
        </div>
        <div class="set-extra-row" data-ex="${i}" data-set="${si}">
          <div class="set-input-wrap" style="flex:0 0 64px"><div class="set-input-label">RIR</div>
            <input class="set-input" type="number" inputmode="numeric" min="0" max="6" placeholder="${escapeHtml(String(b.rir))}" value="${rirVal}" data-field="rir"></div>
          <button class="notes-cat-btn pain-flag-btn ${painFlagged ? 'flagged' : ''}" data-action="toggle-pain" style="margin-top:14px">⚠ Pain</button>
        </div>
        ${!isLastSet ? `<button class="set-rest-btn ${isDone ? 'show' : ''}" data-action="rest" data-ex="${i}" data-set="${si}">Rest ${b.restSec}s</button>` : ''}`;
      }).join('');

      return `<div class="ex-card" id="exc-${i}">
        <div class="ex-card-top">
          <div style="flex:1">
            <div class="ex-card-name">${escapeHtml(ex.name)}</div>
            ${b.note ? `<div class="ex-card-tip">${escapeHtml(b.note)}</div>` : ''}
            <span class="ex-equipment ${EQUIPMENT_CLASS[ex.equipment] || 'eq-bw'}">${EQUIPMENT_LABEL[ex.equipment] || ''}</span>
            ${targetBadge}
          </div>
          <div style="display:flex;flex-direction:column;align-items:flex-end;gap:6px;flex-shrink:0">
            <div class="ex-card-sets">${b.sets} × ${b.repMin}-${b.repMax}</div>
            <div class="ex-check" data-action="toggle-exercise" data-ex="${i}" style="cursor:pointer">
              <svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>
            </div>
          </div>
        </div>
        <button class="log-sets-toggle" data-action="toggle-log" data-ex="${i}">
          <span class="log-sets-label">Log sets</span>
          ${lastBest ? `<span class="log-sets-prev">Last: ${lastBest.weightLb}lbs</span>` : ''}
          <span class="log-sets-arrow">▾</span>
        </button>
        <div class="log-sets-body" data-log-body="${i}">
          ${prevHTML}
          ${setsHTML}
        </div>
        ${hasCues ? `
        <button class="ex-cues-toggle" data-action="toggle-cues" data-ex="${i}">
          <span class="ex-cues-label">Coaching cues</span><span class="cue-arrow">▾</span>
        </button>
        <div class="ex-cues-body" data-cues-body="${i}">
          ${setupHTML ? `<div class="cue-group"><div class="cue-group-label setup">Setup</div>${setupHTML}</div>` : ''}
          ${moveHTML ? `<div class="cue-group"><div class="cue-group-label move">Movement</div>${moveHTML}</div>` : ''}
          ${avoidHTML ? `<div class="cue-group"><div class="cue-group-label avoid">Common mistake</div>${avoidHTML}</div>` : ''}
        </div>` : ''}
      </div>`;
    }).join('');

    const container = document.getElementById('wExercises');
    container.innerHTML = html;
    this._wireExerciseCardEvents(container, session, dateStr);
  }

  _wireExerciseCardEvents(container, session, dateStr) {
    container.querySelectorAll('[data-action="toggle-log"]').forEach(btn => {
      btn.addEventListener('click', () => {
        const i = btn.dataset.ex;
        const body = container.querySelector(`[data-log-body="${i}"]`);
        const open = body.classList.contains('open');
        body.classList.toggle('open', !open);
        btn.classList.toggle('open', !open);
      });
    });
    container.querySelectorAll('[data-action="toggle-cues"]').forEach(btn => {
      btn.addEventListener('click', () => {
        const i = btn.dataset.ex;
        const body = container.querySelector(`[data-cues-body="${i}"]`);
        const open = body.classList.contains('open');
        body.classList.toggle('open', !open);
        btn.classList.toggle('open', !open);
      });
    });
    container.querySelectorAll('[data-action="toggle-exercise"]').forEach(btn => {
      btn.addEventListener('click', () => {
        const i = parseInt(btn.dataset.ex, 10);
        const card = document.getElementById(`exc-${i}`);
        if (this.completedExercises.has(i)) { this.completedExercises.delete(i); card.classList.remove('done'); }
        else { this.completedExercises.add(i); card.classList.add('done'); }
      });
    });
    container.querySelectorAll('[data-action="rest"]').forEach(btn => {
      btn.addEventListener('click', () => this._toggleInlineRest(btn, parseInt(btn.dataset.ex, 10), parseInt(btn.dataset.set, 10), session.blocks[btn.dataset.ex].restSec));
    });
    container.querySelectorAll('[data-action="toggle-pain"]').forEach(btn => {
      btn.addEventListener('click', () => {
        btn.classList.toggle('flagged');
        this._saveRowIfComplete(container, btn.closest('.set-extra-row'), session, dateStr);
      });
    });
    container.querySelectorAll('.set-row, .set-extra-row').forEach(row => {
      row.querySelectorAll('input').forEach(input => {
        input.addEventListener('change', () => this._saveRowIfComplete(container, row, session, dateStr));
      });
    });
    container.querySelectorAll('[data-action="toggle-done"]').forEach(btn => {
      btn.addEventListener('click', () => {
        const row = btn.closest('.set-row');
        const exIdx = parseInt(row.dataset.ex, 10), setIdx = parseInt(row.dataset.set, 10);
        const isLogged = btn.classList.contains('logged');
        if (!isLogged) {
          const wInput = row.querySelector('[data-field="weight"]');
          const rInput = row.querySelector('[data-field="reps"]');
          if (wInput.value && rInput.value) {
            this._saveSet(session, dateStr, exIdx, setIdx);
            btn.classList.add('logged');
            const restBtn = container.querySelector(`[data-action="rest"][data-ex="${exIdx}"][data-set="${setIdx}"]`);
            if (restBtn) restBtn.classList.add('show');
          }
        } else {
          btn.classList.remove('logged');
        }
      });
    });
  }

  _saveRowIfComplete(container, row, session, dateStr) {
    const exIdx = parseInt(row.dataset.ex, 10), setIdx = parseInt(row.dataset.set, 10);
    const setRow = container.querySelector(`.set-row[data-ex="${exIdx}"][data-set="${setIdx}"]`);
    const w = setRow.querySelector('[data-field="weight"]').value;
    const r = setRow.querySelector('[data-field="reps"]').value;
    const isComplete = !!(parseFloat(w) > 0 && parseInt(r, 10) > 0);
    const btn = setRow.querySelector('[data-action="toggle-done"]');
    if (btn) btn.classList.toggle('logged', isComplete);
    if (isComplete) {
      this._saveSet(session, dateStr, exIdx, setIdx);
      // Surface the rest timer regardless of whether the set was marked
      // done by typing (blur/change) or by tapping the checkmark -- the
      // user just finished a set either way.
      const restBtn = container.querySelector(`[data-action="rest"][data-ex="${exIdx}"][data-set="${setIdx}"]`);
      if (restBtn) restBtn.classList.add('show');
    }
  }

  async _saveSet(session, dateStr, exIdx, setIdx) {
    if (!this.store) return;
    const block = session.blocks[exIdx];
    const container = document.getElementById('wExercises');
    const setRow = container.querySelector(`.set-row[data-ex="${exIdx}"][data-set="${setIdx}"]`);
    const extraRow = container.querySelector(`.set-extra-row[data-ex="${exIdx}"][data-set="${setIdx}"]`);
    const weightLb = parseFloat(setRow.querySelector('[data-field="weight"]').value) || 0;
    const reps = parseInt(setRow.querySelector('[data-field="reps"]').value, 10) || 0;
    const rirRaw = extraRow.querySelector('[data-field="rir"]').value;
    const rir = rirRaw === '' ? null : parseInt(rirRaw, 10);
    const painFlag = extraRow.querySelector('[data-action="toggle-pain"]').classList.contains('flagged');

    const id = `${dateStr}|${session.id}|${block.exerciseId}|${setIdx}`;
    const entry = { id, date: dateStr, sessionId: session.id, exerciseId: block.exerciseId, setIndex: setIdx, weightLb, reps, rir, painFlag, note: '', source: 'v2', ts: Date.now() };
    await this.store.putAll('setLogs', [entry]);
    const existingIdx = this.setLogs.findIndex(l => l.id === id);
    if (existingIdx >= 0) this.setLogs[existingIdx] = entry; else this.setLogs.push(entry);
  }

  _toggleInlineRest(btn, exIdx, setIdx, seconds) {
    const key = `${exIdx}-${setIdx}`;
    if (this.inlineRestIntervals[key]) {
      clearInterval(this.inlineRestIntervals[key]);
      delete this.inlineRestIntervals[key];
      btn.textContent = `Rest ${seconds}s`;
      btn.classList.remove('running');
      return;
    }
    btn.classList.add('show', 'running');
    let remaining = seconds;
    btn.textContent = `Resting... ${remaining}s`;
    this.inlineRestIntervals[key] = setInterval(() => {
      remaining--;
      btn.textContent = `Resting... ${remaining}s`;
      if (remaining <= 0) {
        clearInterval(this.inlineRestIntervals[key]);
        delete this.inlineRestIntervals[key];
        btn.textContent = `Rest ${seconds}s`;
        btn.classList.remove('running');
        if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
      }
    }, 1000);
  }

  _startWorkoutTimer() {
    this._stopWorkoutTimer();
    this.workoutStartTime = Date.now();
    const valEl = document.getElementById('workoutTimerVal');
    this.workoutElapsedInterval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - this.workoutStartTime) / 1000);
      valEl.textContent = `${String(Math.floor(elapsed / 60)).padStart(2, '0')}:${String(elapsed % 60).padStart(2, '0')}`;
    }, 1000);
  }

  _stopWorkoutTimer() {
    clearInterval(this.workoutElapsedInterval);
    this.workoutElapsedInterval = null;
    Object.values(this.inlineRestIntervals).forEach(clearInterval);
    this.inlineRestIntervals = {};
    clearInterval(this.cardio.interval);
    this.cardio = { interval: null, remaining: 0, total: 0, running: false };
  }

  _getWorkoutElapsed() {
    if (!this.workoutStartTime) return 0;
    return Math.floor((Date.now() - this.workoutStartTime) / 1000);
  }

  // ---------- Cardio screen ----------

  _renderCardioScreen() {
    const defaultMin = 25;
    const totalSec = defaultMin * 60;
    document.getElementById('wExercises').innerHTML = `
      <div class="cardio-timer-card">
        <div class="cardio-timer-num" id="cardioTimerNum">${defaultMin}:00</div>
        <div class="cardio-timer-sub" id="cardioTimerSub">Tap start when you begin</div>
        <div class="cardio-timer-progress"><div class="cardio-timer-fill" id="cardioFill" style="width:0%"></div></div>
      </div>
      <div class="cardio-controls">
        <button class="cardio-btn cardio-btn-start" id="cardioBtnStart">Start</button>
        <button class="cardio-btn cardio-btn-reset" id="cardioBtnReset">Reset</button>
      </div>
      <div class="cardio-hr-zone">
        <div class="cardio-hr-label">Target heart rate zone</div>
        <div class="cardio-hr-bar">
          <div class="cardio-hr-seg" style="background:rgba(56,189,248,.2);color:var(--phase1)">Z1<br>&lt;120</div>
          <div class="cardio-hr-seg" style="background:rgba(74,222,128,.3);color:var(--phase2);border:1.5px solid var(--phase2)">Z2<br>120-135</div>
          <div class="cardio-hr-seg" style="background:rgba(251,146,60,.2);color:var(--phase3)">Z3<br>135-150</div>
          <div class="cardio-hr-seg" style="background:rgba(167,139,250,.2);color:var(--phase4)">Z4<br>150+</div>
        </div>
      </div>`;
    document.getElementById('cardioBtnStart').addEventListener('click', () => this._toggleCardioTimer(totalSec));
    document.getElementById('cardioBtnReset').addEventListener('click', () => this._resetCardioTimer(totalSec));
  }

  _toggleCardioTimer(totalSec) {
    const btn = document.getElementById('cardioBtnStart');
    if (this.cardio.running) {
      clearInterval(this.cardio.interval);
      this.cardio.running = false;
      btn.textContent = 'Resume';
      btn.classList.remove('cardio-btn-start');
      btn.classList.add('cardio-btn-pause');
    } else {
      if (!this.cardio.total) { this.cardio.total = totalSec; this.cardio.remaining = totalSec; }
      this.cardio.running = true;
      btn.textContent = 'Pause';
      btn.classList.remove('cardio-btn-pause');
      btn.classList.add('cardio-btn-start');
      this.cardio.interval = setInterval(() => {
        this.cardio.remaining--;
        this._updateCardioDisplay();
        if (this.cardio.remaining <= 0) {
          clearInterval(this.cardio.interval);
          this.cardio.running = false;
          btn.textContent = 'Done!';
          document.getElementById('cardioTimerSub').textContent = 'Great session! Tap complete below.';
        }
      }, 1000);
    }
  }

  _resetCardioTimer(totalSec) {
    clearInterval(this.cardio.interval);
    this.cardio = { interval: null, remaining: totalSec, total: totalSec, running: false };
    this._updateCardioDisplay();
    const btn = document.getElementById('cardioBtnStart');
    btn.textContent = 'Start';
    btn.classList.remove('cardio-btn-pause');
    btn.classList.add('cardio-btn-start');
    document.getElementById('cardioTimerSub').textContent = 'Tap start when you begin';
  }

  _updateCardioDisplay() {
    const min = Math.floor(this.cardio.remaining / 60), sec = this.cardio.remaining % 60;
    document.getElementById('cardioTimerNum').textContent = `${min}:${String(sec).padStart(2, '0')}`;
    const pct = this.cardio.total ? ((this.cardio.total - this.cardio.remaining) / this.cardio.total * 100) : 0;
    document.getElementById('cardioFill').style.width = pct + '%';
  }

  // ---------- Finish workout ----------

  async finishWorkout() {
    const isCardio = this.activeSessionId === 'cardio_or_basketball';
    const session = isCardio ? null : this.getSession(this.activeSessionId);
    const elapsed = this._getWorkoutElapsed();
    this._stopWorkoutTimer();
    document.getElementById('workoutTimer').style.display = 'none';

    const summary = this._buildSessionSummary(session, isCardio, elapsed);

    // Audit #7 fix: only record a completed session if at least 1 set was
    // actually logged (cardio always counts as a deliberate "done" tap,
    // since it has no sets to log).
    if (isCardio || summary.totalSetsLogged > 0) {
      if (this.store) {
        await this.store.putAll('sessionHistory', [{ id: `${this.activeDate}_${summary.sessionId}`, ...summary }]);
      }
      await this.refreshHistory();
      await this.refreshWeek();
      this.renderHome();
      this._showSummaryOverlay(summary);
    } else {
      alert('No sets were logged, so this session was not saved. Log at least one set before finishing.');
      window.showScreen('home');
    }
  }

  _buildSessionSummary(session, isCardio, elapsedSec) {
    let totalSetsLogged = 0, exercisesCompleted = 0;
    const prs = [], exSummary = [];
    if (session) {
      session.blocks.forEach(b => {
        const logs = this._todayLogFor(session.id, this.activeDate, b.exerciseId).filter(l => l.weightLb > 0 && l.reps > 0);
        const ex = this.exerciseById.get(b.exerciseId);
        const name = ex ? ex.name : b.exerciseId;
        if (logs.length > 0) {
          exercisesCompleted++;
          totalSetsLogged += logs.length;
          const best = logs.reduce((a, c) => (c.weightLb > a.weightLb ? c : a));
          exSummary.push({ name, sets: logs.length, best: { weightLb: best.weightLb, reps: best.reps } });
          const prior = this._priorSessionsFor(b.exerciseId, this.activeDate);
          const lastBest = prior.length ? prior[prior.length - 1].reduce((a, c) => (c.weightLb > a.weightLb ? c : a)) : null;
          if (lastBest && best.weightLb > lastBest.weightLb) prs.push({ name, prev: lastBest.weightLb, now: best.weightLb });
        } else {
          exSummary.push({ name, sets: 0, best: null });
        }
      });
    }
    return {
      sessionId: this.activeSessionId,
      title: session ? session.title : 'Cardio',
      tag: session ? session.focus : 'Cardio',
      date: this.activeDate,
      elapsedSec,
      isCardio,
      totalSetsLogged,
      exercisesCompleted,
      prs,
      exSummary,
    };
  }

  _showSummaryOverlay(data) {
    const overlay = document.getElementById('summaryOverlay');
    const elMin = Math.floor(data.elapsedSec / 60), elSec = data.elapsedSec % 60;
    const timeStr = `${elMin}:${String(elSec).padStart(2, '0')}`;
    const streak = computeStreak(this.program, this.sessionHistory);
    const sessions = sessionsCompletedCount(this.sessionHistory);

    document.getElementById('summaryTitle').textContent = 'SESSION COMPLETE';
    document.getElementById('summarySub').textContent = `${data.title} · ${data.date}`;
    document.getElementById('summaryStats').innerHTML = data.isCardio
      ? `<div class="summary-stat"><div class="summary-stat-num">${timeStr}</div><div class="summary-stat-label">Duration</div></div>
         <div class="summary-stat"><div class="summary-stat-num">${sessions}</div><div class="summary-stat-label">Total sessions</div></div>
         <div class="summary-stat"><div class="summary-stat-num">${streak}</div><div class="summary-stat-label">Day streak</div></div>`
      : `<div class="summary-stat"><div class="summary-stat-num">${timeStr}</div><div class="summary-stat-label">Duration</div></div>
         <div class="summary-stat"><div class="summary-stat-num">${data.totalSetsLogged}</div><div class="summary-stat-label">Sets logged</div></div>
         <div class="summary-stat"><div class="summary-stat-num">${data.exercisesCompleted}</div><div class="summary-stat-label">Exercises</div></div>`;

    const prsEl = document.getElementById('summaryPrs');
    if (data.prs.length > 0) {
      prsEl.innerHTML = `<div class="summary-pr-label">Weight PRs</div>${data.prs.map(p => `<div class="summary-pr-item">
        <span class="summary-pr-name">${escapeHtml(p.name)}</span><span class="summary-pr-val">${p.prev}lbs → ${p.now}lbs</span>
      </div>`).join('')}`;
      prsEl.style.display = '';
    } else prsEl.style.display = 'none';

    const exEl = document.getElementById('summaryExercises');
    if (!data.isCardio && data.exSummary.length > 0) {
      exEl.innerHTML = `<div class="summary-ex-label">Exercise breakdown</div>${data.exSummary.map(e => `<div class="summary-ex-row">
        <span class="summary-ex-name">${escapeHtml(e.name)}</span>
        <span class="summary-ex-data">${e.sets > 0 ? `${e.sets} sets · ${e.best.weightLb}lbs × ${e.best.reps}` : 'Not logged'}</span>
      </div>`).join('')}`;
      exEl.style.display = '';
    } else exEl.style.display = 'none';

    overlay.classList.add('show');
  }

  closeSummary() {
    document.getElementById('summaryOverlay').classList.remove('show');
    this.renderWeekGrid();
    window.showScreen('home');
  }

  // ---------- Body log, weight trend, nutrition target, wedding countdown ----------

  _renderWeddingCountdown() {
    const el = document.getElementById('weddingCountdown');
    if (!el) return;
    const days = daysUntilEvent(this.program, new Date());
    const eventLabel = new Date(this.program.meta.eventDate + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
    el.innerHTML = `<div class="today-tag">Wedding countdown</div>
      <div class="today-title">${days >= 0 ? `${days} DAY${days === 1 ? '' : 'S'}` : 'TODAY!'}</div>
      <div class="today-meta">${escapeHtml(eventLabel)}</div>`;
  }

  _wireBodyLogForm() {
    const today = localDateStr(new Date());
    const existing = this.bodyLogs.find(l => l.date === today);
    if (existing) {
      if (existing.weightLb != null) document.getElementById('bodyLogWeight').value = existing.weightLb;
      if (existing.waistIn != null) document.getElementById('bodyLogWaist').value = existing.waistIn;
      if (existing.kcal != null) document.getElementById('bodyLogKcal').value = existing.kcal;
      if (existing.proteinG != null) document.getElementById('bodyLogProtein').value = existing.proteinG;
    }
    document.getElementById('bodyLogSaveBtn').addEventListener('click', () => this._saveBodyLog());
  }

  async _saveBodyLog() {
    const weightLb = parseFloat(document.getElementById('bodyLogWeight').value);
    if (!(weightLb > 0)) {
      alert('Enter a weight before saving (waist, calories, and protein are optional).');
      return;
    }
    if (!this.store) { alert('Changes cannot be saved right now (storage unavailable).'); return; }
    const date = localDateStr(new Date());
    const waistRaw = document.getElementById('bodyLogWaist').value;
    const kcalRaw = document.getElementById('bodyLogKcal').value;
    const proteinRaw = document.getElementById('bodyLogProtein').value;
    const entry = {
      id: date,
      date,
      weightLb,
      waistIn: waistRaw ? parseFloat(waistRaw) : null,
      kcal: kcalRaw ? parseInt(kcalRaw, 10) : null,
      proteinG: proteinRaw ? parseInt(proteinRaw, 10) : null,
    };
    await this.store.putAll('bodyLogs', [entry]);
    const idx = this.bodyLogs.findIndex(l => l.id === date);
    if (idx >= 0) this.bodyLogs[idx] = entry; else this.bodyLogs.push(entry);

    const flash = document.getElementById('bodyLogFlash');
    flash.textContent = 'Saved';
    flash.style.opacity = '1';
    setTimeout(() => { flash.style.opacity = '0'; }, 2000);
    this._renderWeightChart();
  }

  _renderWeightChart() {
    const container = document.getElementById('weightChart');
    if (!container) return;
    const today = new Date();
    const logsWithWeight = this.bodyLogs.filter(l => l.weightLb > 0);
    if (logsWithWeight.length === 0) {
      container.innerHTML = `<div class="no-history">No weigh-ins logged yet. Log today's weight above to start the trend.</div>`;
      return;
    }
    const firstLogDate = parseLocalDateStr(logsWithWeight.map(l => l.date).sort()[0]);
    const windowStart = new Date(Math.min(firstLogDate.getTime(), today.getTime() - 29 * 86400000));
    const rolling = computeRollingAverage(this.bodyLogs).filter(p => parseLocalDateStr(p.date) >= windowStart);
    const band = computeTargetBand(this.program, windowStart, today);

    const allWeights = [...rolling.map(p => p.avgWeightLb), ...band.map(p => p.minWeightLb), ...band.map(p => p.maxWeightLb)];
    const minY = Math.min(...allWeights) - 1;
    const maxY = Math.max(...allWeights) + 1;
    const totalDays = Math.max(1, Math.round((today - windowStart) / 86400000));
    const W = 340, H = 140, PAD = 8;
    const x = d => PAD + ((parseLocalDateStr(d) - windowStart) / 86400000) / totalDays * (W - 2 * PAD);
    const y = w => H - PAD - (w - minY) / (maxY - minY) * (H - 2 * PAD);

    const bandTop = band.map(p => `${x(p.date)},${y(p.maxWeightLb)}`).join(' ');
    const bandBottom = band.slice().reverse().map(p => `${x(p.date)},${y(p.minWeightLb)}`).join(' ');
    const bandPolygon = band.length > 1 ? `<polygon points="${bandTop} ${bandBottom}" fill="rgba(200,241,53,0.08)" stroke="none"/>` : '';
    const linePoints = rolling.map(p => `${x(p.date)},${y(p.avgWeightLb)}`).join(' ');
    const dots = rolling.map(p => `<circle cx="${x(p.date)}" cy="${y(p.avgWeightLb)}" r="2.5" fill="#c8f135"/>`).join('');

    container.innerHTML = `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:140px" preserveAspectRatio="none">
      ${bandPolygon}
      ${rolling.length > 1 ? `<polyline points="${linePoints}" fill="none" stroke="#c8f135" stroke-width="2"/>` : ''}
      ${dots}
    </svg>
    <div style="display:flex;justify-content:space-between;font-size:10px;color:var(--muted);margin-top:4px">
      <span>${escapeHtml(localDateStr(windowStart))}</span>
      <span style="color:var(--accent)">7-day avg</span>
      <span>${escapeHtml(localDateStr(today))}</span>
    </div>`;
  }

  async _renderNutritionTargetCard() {
    const el = document.getElementById('nutritionTargetCard');
    if (!el) return;
    const meta = this.store ? await this.store.getMeta() : {};
    const target = meta.nutritionTarget;
    const range = this.program.nutrition.proteinTargetGPerDay;
    const kcalRow = target?.kcalTarget != null
      ? `<div class="drawer-ex-name">${target.kcalTarget} kcal / day</div>`
      : `<div class="drawer-ex-name" style="color:var(--muted)">No calorie baseline set yet</div>`;
    const proteinTarget = target?.proteinTargetG ?? range.default;
    el.innerHTML = `${kcalRow}
      <div class="today-meta" style="margin-bottom:10px">Protein target: ${proteinTarget}g/day (range ${range.min}-${range.max}g)</div>
      <div class="set-row" style="grid-template-columns:1fr auto;gap:8px">
        <input class="set-input" type="number" inputmode="numeric" id="nutritionManualKcal" placeholder="Set starting calorie target">
        <button class="notes-copy-btn" style="width:auto;padding:8px 14px;margin-top:0" id="nutritionManualSaveBtn">Save</button>
      </div>
      <div class="drawer-ex-tip" style="margin-top:6px">Ask Claude to estimate a starting number (age, height, weight are in your Nutrition agent prompt on the Plan tab), or type one here directly -- this is a one-time baseline, not a capped adjustment.</div>`;
    document.getElementById('nutritionManualSaveBtn').addEventListener('click', async () => {
      const val = parseInt(document.getElementById('nutritionManualKcal').value, 10);
      if (!(val > 0)) { alert('Enter a positive calorie number first.'); return; }
      if (!this.store) { alert('Changes cannot be saved right now (storage unavailable).'); return; }
      await this.store.putMeta({ nutritionTarget: { kcalTarget: val, proteinTargetG: proteinTarget, lastAdjustment: null } });
      this._renderNutritionTargetCard();
    });
  }

  // ---------- Overload / progress screen ----------

  async renderOverload() {
    if (this.store) this.bodyLogs = await this.store.getAll('bodyLogs');
    this._renderWeddingCountdown();
    this._renderWeightChart();
    await this._renderNutritionTargetCard();
    const el = document.getElementById('overloadContent');
    const exerciseIds = [...new Set(this.setLogs.map(l => l.exerciseId))];
    const withData = [];
    for (const exerciseId of exerciseIds) {
      const sessions = this._priorSessionsFor(exerciseId, null); // null date excludes nothing
      if (sessions.length === 0) continue;
      const ex = this.exerciseById.get(exerciseId);
      const name = ex ? ex.name : exerciseId;
      withData.push({ exerciseId, name, sessions });
    }

    if (withData.length === 0) {
      el.innerHTML = `<div class="overload-hero">
        <div class="overload-hero-label">Getting started</div>
        <div class="overload-hero-title">No sessions logged yet</div>
        <div class="overload-hero-sub">Log your first workout to start tracking progressive overload.</div>
      </div>
      <div class="no-history">Complete a session and log your weights to see your strength progress and get personalised overload targets here.</div>`;
      return;
    }

    const block = { repMin: 8, repMax: 12 }; // display-only fallback when the exercise isn't in this week's plan
    const readyToProgress = withData.filter(e => {
      const last = e.sessions[e.sessions.length - 1];
      const b = this._blockFor(e.exerciseId) || block;
      return last.every(s => s.reps >= b.repMax);
    });
    const heroHTML = readyToProgress.length > 0
      ? `<div class="overload-hero"><div class="overload-hero-label">Ready to progress</div>
         <div class="overload-hero-title">${readyToProgress.length} lift${readyToProgress.length > 1 ? 's' : ''} ready to go up</div>
         <div class="overload-hero-sub">${escapeHtml(readyToProgress.map(e => e.name).join(' · '))}</div></div>`
      : `<div class="overload-hero"><div class="overload-hero-label">Keep building</div>
         <div class="overload-hero-title">Consistency is working</div>
         <div class="overload-hero-sub">Hit the top of your rep range across all sets to unlock the next weight jump.</div></div>`;

    const cardsHTML = withData.map(e => {
      const b = this._blockFor(e.exerciseId) || block;
      const target = computeTarget(e.sessions, b);
      const recentDates = [...new Set(this.setLogs.filter(l => l.exerciseId === e.exerciseId).map(l => l.date))].sort().slice(-4);
      const sessionRows = recentDates.map((date, idx) => {
        const daySets = this.setLogs.filter(l => l.exerciseId === e.exerciseId && l.date === date && l.weightLb > 0 && l.reps > 0);
        if (daySets.length === 0) return '';
        const best = daySets.reduce((a, c) => (c.weightLb > a.weightLb ? c : a));
        const prevDate = recentDates[idx - 1];
        const prevSets = prevDate ? this.setLogs.filter(l => l.exerciseId === e.exerciseId && l.date === prevDate && l.weightLb > 0 && l.reps > 0) : [];
        const prevBest = prevSets.length ? prevSets.reduce((a, c) => (c.weightLb > a.weightLb ? c : a)) : null;
        const delta = prevBest ? best.weightLb - prevBest.weightLb : 0;
        const deltaHTML = delta > 0 ? `<span class="lift-delta up">+${delta}lbs</span>` : `<span class="lift-delta same">—</span>`;
        return `<div class="lift-session-row">
          <span class="lift-session-date">${escapeHtml(date.slice(5))}</span>
          <span class="lift-session-data">${best.weightLb}lbs × ${best.reps} reps ${deltaHTML}</span>
        </div>`;
      }).join('');
      const targetHTML = target ? `<div class="lift-next-target">
        <span class="lift-next-label">Next target</span>
        <span class="lift-next-val">${target.weightLb}lbs × ${target.reps} reps</span>
      </div>` : '';
      return `<div class="lift-history-card">
        <div class="lift-history-name">${escapeHtml(e.name)}</div>
        <div class="lift-history-sessions">${sessionRows}</div>
        ${targetHTML}
      </div>`;
    }).join('');

    el.innerHTML = heroHTML + `<div class="section-label">Lift history</div>` + cardsHTML;
  }

  _blockFor(exerciseId) {
    for (const session of this.resolvedWeek.sessions) {
      const b = session.blocks.find(bl => bl.exerciseId === exerciseId);
      if (b) return b;
    }
    return null;
  }
}

const app = new WorkoutApp();
app.init();

window.ForgeWorkout = {
  openToday: () => app.openToday(),
  openDayDrawer: dayIdx => app.openDayDrawer(dayIdx),
  closeDrawer: () => app.closeDrawer(),
  finishWorkout: () => app.finishWorkout(),
  closeSummary: () => app.closeSummary(),
  renderOverload: () => app.renderOverload(),
  hasActiveSession: () => app.hasActiveSession(),
};
