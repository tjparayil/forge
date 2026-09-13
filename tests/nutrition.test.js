import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { computeRollingAverage, computeTargetBand, daysUntilEvent } from '../js/nutrition.js';
import { parseLocalDateStr } from '../js/store.js';

let program;
before(() => {
  program = JSON.parse(readFileSync(new URL('../data/program.json', import.meta.url)));
});

describe('computeRollingAverage', () => {
  test('averages within a trailing 7-day window, not requiring a full week of data', () => {
    const logs = [
      { date: '2026-09-14', weightLb: 165 },
      { date: '2026-09-15', weightLb: 167 },
    ];
    const result = computeRollingAverage(logs);
    assert.equal(result.length, 2);
    assert.equal(result[0].avgWeightLb, 165);
    assert.equal(result[0].sampleSize, 1);
    assert.equal(result[1].avgWeightLb, 166); // (165+167)/2
    assert.equal(result[1].sampleSize, 2);
  });

  test('excludes entries outside the trailing window once more than 7 days of data exist', () => {
    const logs = [];
    for (let i = 0; i < 10; i++) {
      logs.push({ date: `2026-09-${String(14 + i).padStart(2, '0')}`, weightLb: 165 + i });
    }
    const result = computeRollingAverage(logs);
    const last = result[result.length - 1]; // day 10 (weight 174), window = days 4-10 (weights 168-174)
    assert.equal(last.sampleSize, 7);
    assert.equal(last.avgWeightLb, (168 + 169 + 170 + 171 + 172 + 173 + 174) / 7);
  });

  test('ignores entries with no weight logged (e.g. a waist-only day)', () => {
    const logs = [{ date: '2026-09-14', weightLb: 165 }, { date: '2026-09-15', waistIn: 34 }];
    const result = computeRollingAverage(logs);
    assert.equal(result.length, 1);
  });

  test('empty input returns an empty array, not an error', () => {
    assert.deepEqual(computeRollingAverage([]), []);
  });
});

describe('computeTargetBand', () => {
  test('is flat (no change) on the start date itself', () => {
    const start = parseLocalDateStr(program.meta.startDate);
    const band = computeTargetBand(program, start, start);
    assert.equal(band.length, 1);
    assert.equal(band[0].minWeightLb, program.meta.athlete.startWeightLb);
    assert.equal(band[0].maxWeightLb, program.meta.athlete.startWeightLb);
  });

  test('widens over a lean-gain block (week 1-4, Base) and flattens during the travel deload (week 5)', () => {
    const start = parseLocalDateStr(program.meta.startDate);
    const endOfWeek4 = new Date(start); endOfWeek4.setDate(endOfWeek4.getDate() + 27); // last day of week 4
    const endOfWeek5 = new Date(start); endOfWeek5.setDate(endOfWeek5.getDate() + 34); // last day of week 5 (deload)

    const bandWeek4 = computeTargetBand(program, endOfWeek4, endOfWeek4)[0];
    const bandWeek5 = computeTargetBand(program, endOfWeek5, endOfWeek5)[0];

    // Base = lean_gain (0.25-0.5 lb/wk); should have grown over 4 weeks.
    assert.ok(bandWeek4.minWeightLb > program.meta.athlete.startWeightLb);
    assert.ok(bandWeek4.maxWeightLb > bandWeek4.minWeightLb);

    // Travel deload = maintenance (-0.1 to 0.1 lb/wk); one more week should
    // barely move the band compared to the jump seen across weeks 1-4.
    const week4to5Growth = bandWeek5.maxWeightLb - bandWeek4.maxWeightLb;
    assert.ok(week4to5Growth < 0.2, `expected a small maintenance-week change, got ${week4to5Growth}`);
  });

  test('band only returns points from fromDate onward, even though accumulation starts at the program start', () => {
    const start = parseLocalDateStr(program.meta.startDate);
    const midway = new Date(start); midway.setDate(midway.getDate() + 10);
    const later = new Date(start); later.setDate(later.getDate() + 12);
    const band = computeTargetBand(program, midway, later);
    assert.equal(band.length, 3); // midway, midway+1, midway+2
    assert.equal(band[0].date, localDateStrOf(midway));
  });
});

// Small local helper so the last test above doesn't need a separate import
// just for one assertion's date-string formatting.
function localDateStrOf(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

describe('daysUntilEvent', () => {
  test('counts down to the wedding date exactly', () => {
    const oneWeekBefore = parseLocalDateStr('2027-04-10');
    assert.equal(daysUntilEvent(program, oneWeekBefore), 7);
  });

  test('is zero on the event date itself', () => {
    const eventDay = parseLocalDateStr('2027-04-17');
    assert.equal(daysUntilEvent(program, eventDay), 0);
  });

  test('is negative after the event has passed', () => {
    const afterward = parseLocalDateStr('2027-04-20');
    assert.equal(daysUntilEvent(program, afterward), -3);
  });
});
