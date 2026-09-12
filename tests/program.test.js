import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  blockForWeek,
  weekNumberForDate,
  estimateSessionMinutes,
  resolveWeek,
} from '../js/program.js';
import { parseLocalDateStr } from '../js/store.js';

let program;
before(() => {
  program = JSON.parse(readFileSync(new URL('../data/program.json', import.meta.url)));
});

function findBlock(session, exerciseId) {
  return session.blocks.find(b => b.exerciseId === exerciseId);
}
function findSession(resolved, sessionId) {
  return resolved.sessions.find(s => s.id === sessionId);
}

describe('weekNumberForDate', () => {
  test('start date itself is week 1', () => {
    assert.equal(weekNumberForDate(program, parseLocalDateStr('2026-09-14')), 1);
  });

  test('last day of week 1 (Sunday) is still week 1', () => {
    assert.equal(weekNumberForDate(program, parseLocalDateStr('2026-09-20')), 1);
  });

  test('first day of week 2 rolls over correctly', () => {
    assert.equal(weekNumberForDate(program, parseLocalDateStr('2026-09-21')), 2);
  });

  test('matches every block\'s own declared startDate (cross-check the seed data)', () => {
    for (const block of program.blocks) {
      const expectedWeek = block.weeks[0];
      assert.equal(
        weekNumberForDate(program, parseLocalDateStr(block.startDate)),
        expectedWeek,
        `block ${block.id} startDate ${block.startDate} should resolve to week ${expectedWeek}`
      );
    }
  });

  test('clamps to week 1 before the program starts', () => {
    assert.equal(weekNumberForDate(program, parseLocalDateStr('2026-01-01')), 1);
  });

  test('clamps to totalWeeks (31, not 52) after the program ends', () => {
    assert.equal(weekNumberForDate(program, parseLocalDateStr('2028-01-01')), 31);
    assert.equal(program.meta.totalWeeks, 31);
  });
});

describe('resolveWeek: base week (week 1, multiplier 1.0, no tagged add)', () => {
  test('sets match the seed exactly, unmodified', () => {
    const week1 = resolveWeek(program, 1);
    const fba = findSession(week1, 'FBA');
    assert.equal(findBlock(fba, 'bb_back_squat').sets, 4);
    assert.equal(findBlock(fba, 'bb_bench').sets, 3);
    assert.equal(findBlock(fba, 'cable_lateral_raise').sets, 3);
  });

  test('estimated session minutes match the seed\'s authored estimates', () => {
    const week1 = resolveWeek(program, 1);
    assert.equal(findSession(week1, 'FBA').estMinutes, 57);
    assert.equal(findSession(week1, 'FBB').estMinutes, 57);
    assert.equal(findSession(week1, 'FBC').estMinutes, 55);
  });
});

describe('resolveWeek: travel deload (week 5, multiplier 0.5)', () => {
  test('sets are halved and rounded half up, minimum 1', () => {
    const week5 = resolveWeek(program, 5);
    const fba = findSession(week5, 'FBA');
    assert.equal(findBlock(fba, 'bb_back_squat').sets, 2);   // 4 * 0.5 = 2
    assert.equal(findBlock(fba, 'bb_bench').sets, 2);        // 3 * 0.5 = 1.5 -> round half up -> 2
    assert.equal(findBlock(fba, 'ez_curl').sets, 1);         // 2 * 0.5 = 1
  });

  test('never rounds below 1 set', () => {
    const week5 = resolveWeek(program, 5);
    for (const session of week5.sessions) {
      for (const b of session.blocks) assert.ok(b.sets >= 1, `${session.id}/${b.exerciseId} has ${b.sets} sets`);
    }
  });
});

describe('resolveWeek: build 3 / peak volume (week 17, +1 tagged set)', () => {
  test('progressVolume-tagged blocks get +1 set; untagged blocks are unchanged', () => {
    const week17 = resolveWeek(program, 17);
    const fba = findSession(week17, 'FBA');
    assert.equal(findBlock(fba, 'cable_lateral_raise').sets, 4); // tagged: 3 + 1
    assert.equal(findBlock(fba, 'bb_back_squat').sets, 4);       // untagged: unchanged

    const fbc = findSession(week17, 'FBC');
    assert.equal(findBlock(fbc, 'lat_pulldown_neutral').sets, 4); // tagged: 3 + 1
    assert.equal(findBlock(fbc, 'lying_leg_curl').sets, 4);       // tagged: 3 + 1
  });
});

describe('resolveWeek: taper (week 29, multiplier 0.7)', () => {
  test('sets are scaled by 0.7 and rounded half up', () => {
    const week29 = resolveWeek(program, 29);
    const fba = findSession(week29, 'FBA');
    assert.equal(findBlock(fba, 'bb_back_squat').sets, 3); // 4 * 0.7 = 2.8 -> 3
    assert.equal(findBlock(fba, 'bb_bench').sets, 2);      // 3 * 0.7 = 2.1 -> 2
  });
});

describe('resolveWeek: wedding week (week 31, multiplier 0.5)', () => {
  test('resolves without error and halves sets', () => {
    const week31 = resolveWeek(program, 31);
    const fba = findSession(week31, 'FBA');
    assert.equal(findBlock(fba, 'bb_back_squat').sets, 2);
    assert.equal(week31.block.note.includes('Nothing Thu-Sat'), true);
  });
});

describe('resolveWeek: out-of-range weeks', () => {
  test('throws for week 0 and week 32', () => {
    assert.throws(() => resolveWeek(program, 0));
    assert.throws(() => resolveWeek(program, 32));
  });
});

describe('resolveWeek: overrides apply only to the targeted week', () => {
  const override = {
    weekNumber: 3,
    changes: [{ op: 'set_sets', sessionId: 'FBA', exerciseId: 'bb_back_squat', fields: { sets: 5 } }],
  };

  test('the targeted week reflects the override', () => {
    const week3 = resolveWeek(program, 3, [override]);
    assert.equal(findBlock(findSession(week3, 'FBA'), 'bb_back_squat').sets, 5);
    assert.equal(findBlock(findSession(week3, 'FBA'), 'bb_back_squat').overridden, true);
  });

  test('other weeks are unaffected by a week-scoped override', () => {
    const week1 = resolveWeek(program, 1, [override]);
    const week4 = resolveWeek(program, 4, [override]);
    assert.equal(findBlock(findSession(week1, 'FBA'), 'bb_back_squat').sets, 4);
    assert.equal(findBlock(findSession(week4, 'FBA'), 'bb_back_squat').sets, 4);
  });

  test('swap_exercise changes the exerciseId and marks overridden', () => {
    const swap = {
      weekNumber: 2,
      changes: [{ op: 'swap_exercise', sessionId: 'FBA', exerciseId: 'lat_pulldown_wide', fields: { newExerciseId: 'seated_cable_row' } }],
    };
    const week2 = resolveWeek(program, 2, [swap]);
    const fba = findSession(week2, 'FBA');
    assert.equal(findBlock(fba, 'lat_pulldown_wide'), undefined);
    const swapped = fba.blocks.find(b => b.exerciseId === 'seated_cable_row');
    assert.ok(swapped);
    assert.equal(swapped.overridden, true);
  });

  test('move_day changes the schedule for that week only', () => {
    const moved = { weekNumber: 6, changes: [{ op: 'move_day', fields: { day: 'tue', sessionId: 'FBC' } }] };
    const week6 = resolveWeek(program, 6, [moved]);
    const week1 = resolveWeek(program, 1, [moved]);
    assert.equal(week6.schedule.tue, 'FBC');
    assert.equal(week1.schedule.tue, 'cardio_or_basketball');
  });
});

describe('estimateSessionMinutes', () => {
  test('a superset group with unequal set counts still produces a sane estimate (FBB, seed value 57)', () => {
    const week1 = resolveWeek(program, 1);
    assert.equal(findSession(week1, 'FBB').estMinutes, 57);
  });
});
