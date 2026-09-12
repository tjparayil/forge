// js/util.js
// Small helpers shared across screen modules.

// Escapes user/AI text before it goes into innerHTML (fixes audit #8: the
// old app injected note text unescaped, breaking on "<" and unsafe once AI
// text renders too). Always use this for any dynamic string in a template
// literal that gets assigned to .innerHTML.
export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

export const DAY_ORDER = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
export const DAY_LABELS = { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' };
export const DAY_FULL = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday' };

/** 0=Mon..6=Sun for a given Date, using LOCAL time (JS's getDay() is 0=Sun). */
export function mondayIndexOf(date) {
  return (date.getDay() + 6) % 7;
}

export function dayKeyOf(date) {
  return DAY_ORDER[mondayIndexOf(date)];
}

/** The local-time Date for a given Mon=0..Sun=6 weekday index, within the current calendar week. */
export function dateForWeekdayIndex(dayIdx, today = new Date()) {
  const todayIdx = mondayIndexOf(today);
  const d = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  d.setDate(d.getDate() + (dayIdx - todayIdx));
  return d;
}
