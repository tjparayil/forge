// js/stats.js
// Session-count and streak stats, computed live from sessionHistory rather
// than a separately-incremented counter (fixes audit #7: the old app
// incremented a counter unconditionally, so it could double count or count
// empty sessions -- counting sessionHistory.length directly makes that bug
// class structurally impossible: one entry per completed session, deduped
// by date+session in the store layer).
//
// Also fixes audit #6: the old streak broke on scheduled rest days because
// it only compared "yesterday" to "today". This instead walks backward
// over the program's own weekly schedule and only counts (or breaks on)
// days that were actually scheduled lifting days.

import { localDateStr } from './store.js';

const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

function dayKeyFor(date) {
  return DAY_KEYS[(date.getDay() + 6) % 7]; // getDay(): 0=Sun -> shift so 0=Mon
}

function isScheduledLiftDay(program, dayKey) {
  const sessionId = program.schedule[dayKey];
  return program.sessions.some(s => s.id === sessionId);
}

/**
 * Consecutive scheduled lifting days with a completed session, walking
 * backward from today. Non-lifting days (rest/cardio) are skipped without
 * breaking the streak. A missed scheduled lifting day breaks it. Today
 * itself never breaks the streak just because it isn't logged yet (the
 * day isn't over) -- it only counts once actually completed.
 *
 * @param {object} program - parsed data/program.json (uses the default
 *   weekly schedule; per-week move_day overrides are not consulted here --
 *   a deliberate simplification for a display stat, not a scheduling rule)
 * @param {Array<{date:string}>} sessionHistory - completed session records
 */
export function computeStreak(program, sessionHistory, today = new Date()) {
  const completedDates = new Set(sessionHistory.map(s => s.date));
  let cursor = new Date(today.getFullYear(), today.getMonth(), today.getDate());

  if (isScheduledLiftDay(program, dayKeyFor(cursor)) && !completedDates.has(localDateStr(cursor))) {
    cursor.setDate(cursor.getDate() - 1); // today not done yet -- don't penalize before the day is over
  }

  let streak = 0;
  for (let i = 0; i < 400; i++) { // hard cap: 400 days is well past the 31-week program
    if (isScheduledLiftDay(program, dayKeyFor(cursor))) {
      if (completedDates.has(localDateStr(cursor))) streak++;
      else break;
    }
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

/** Total completed sessions -- just the count of history entries, one source of truth. */
export function sessionsCompletedCount(sessionHistory) {
  return sessionHistory.length;
}
