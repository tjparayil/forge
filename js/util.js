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

/**
 * Parse JSON out of pasted agent text. Claude often wraps JSON in a
 * ```json fence, sometimes with a sentence before/after -- this pulls the
 * fenced block if present, otherwise tries the raw text, and throws a
 * plain Error with a friendly message on failure (never invents data).
 */
export function extractJson(text) {
  if (!text || !text.trim()) throw new Error('Paste the response text first.');
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const raw = (fenced ? fenced[1] : text).trim();
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`That doesn't look like valid JSON (${err.message}). Paste only the JSON object Claude returned.`);
  }
}
