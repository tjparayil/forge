// js/nutrition.js
// Phase 5: body-log trend math (handover Section 7). Pure functions --
// given bodyLogs and the program, compute the 7-day rolling average and a
// target weight band, and the wedding countdown. No I/O, no DOM.

import { localDateStr, parseLocalDateStr } from './store.js';
import { weekNumberForDate, blockForWeek } from './program.js';

const DAY_MS = 24 * 60 * 60 * 1000;

function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

/**
 * 7-day rolling average weight for each date that has at least one log,
 * averaging whatever entries fall within the trailing window (does not
 * require a full 7 days of data to start showing a trend).
 */
export function computeRollingAverage(bodyLogs, windowDays = 7) {
  const withWeight = bodyLogs.filter(l => l.weightLb > 0).slice().sort((a, b) => a.date.localeCompare(b.date));
  return withWeight.map(log => {
    const end = parseLocalDateStr(log.date);
    const start = addDays(end, -(windowDays - 1));
    const inWindow = withWeight.filter(l => {
      const d = parseLocalDateStr(l.date);
      return d >= start && d <= end;
    });
    const avg = inWindow.reduce((sum, l) => sum + l.weightLb, 0) / inWindow.length;
    return { date: log.date, avgWeightLb: round1(avg), sampleSize: inWindow.length };
  });
}

/**
 * Expected weight band from the program's start date through `toDate`,
 * accumulating each week's actual nutrition-phase target rate (so a band
 * spanning a deload week correctly flattens to that week's maintenance
 * rate instead of extrapolating the surrounding block's rate through it).
 * Returns only the points from `fromDate` onward, but the accumulation
 * itself always starts at the program's real start date so the band
 * reflects the true cumulative trajectory.
 */
export function computeTargetBand(program, fromDate, toDate) {
  const startDate = parseLocalDateStr(program.meta.startDate);
  const startWeight = program.meta.athlete.startWeightLb;
  const points = [];
  let minW = startWeight;
  let maxW = startWeight;
  let cursor = new Date(startDate);
  while (cursor <= toDate) {
    if (cursor > startDate) {
      const weekNum = weekNumberForDate(program, cursor);
      const block = blockForWeek(program, weekNum);
      const phase = program.nutrition.phases[block?.nutritionPhase];
      const rate = phase?.targetGainLbPerWeek || { min: 0, max: 0 };
      minW += rate.min / 7;
      maxW += rate.max / 7;
    }
    if (cursor >= fromDate) {
      points.push({ date: localDateStr(cursor), minWeightLb: round1(minW), maxWeightLb: round1(maxW) });
    }
    cursor = addDays(cursor, 1);
  }
  return points;
}

/** Whole days remaining until the event date (handover Section 1: April 17, 2027). Negative once past. */
export function daysUntilEvent(program, today = new Date()) {
  const event = parseLocalDateStr(program.meta.eventDate);
  const todayMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((event - todayMidnight) / DAY_MS);
}
