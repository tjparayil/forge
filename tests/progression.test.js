import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { computeTarget, detectStall, stallRecoveryWeight } from '../js/progression.js';

const block = { repMin: 8, repMax: 10 };

describe('computeTarget', () => {
  test('no history returns null', () => {
    assert.equal(computeTarget([], block), null);
    assert.equal(computeTarget(null, block), null);
  });

  test('an empty last session (skipped) returns null', () => {
    assert.equal(computeTarget([[]], block), null);
  });

  test('every set at or above repMax: add 5 lb, restart at repMin', () => {
    const history = [[{ weightLb: 135, reps: 10 }, { weightLb: 135, reps: 10 }]];
    const target = computeTarget(history, block);
    assert.deepEqual({ weightLb: target.weightLb, reps: target.reps, stalled: target.stalled }, { weightLb: 140, reps: 8, stalled: false });
  });

  test('some sets below repMax: same weight, add a rep (capped at repMax)', () => {
    const history = [[{ weightLb: 135, reps: 9 }, { weightLb: 135, reps: 8 }]];
    const target = computeTarget(history, block);
    assert.deepEqual({ weightLb: target.weightLb, reps: target.reps }, { weightLb: 135, reps: 9 }); // min reps 8 + 1
  });

  test('reps+1 never exceeds repMax', () => {
    const history = [[{ weightLb: 135, reps: 10 }, { weightLb: 135, reps: 9 }]]; // not ALL at repMax, so reps+1 path
    const target = computeTarget(history, block);
    assert.equal(target.reps, 10); // min(9)+1=10, capped at repMax(10) anyway
  });

  test('uses the heaviest set as the reference weight when sets vary', () => {
    const history = [[{ weightLb: 135, reps: 10 }, { weightLb: 140, reps: 10 }]];
    const target = computeTarget(history, block);
    assert.equal(target.weightLb, 145); // max(135,140) + 5
  });
});

describe('detectStall', () => {
  test('fewer than 2 sessions is never a stall', () => {
    assert.equal(detectStall([[{ weightLb: 135, reps: 5 }]], block), false);
  });

  test('2 consecutive sessions all below repMin is a stall', () => {
    const history = [
      [{ weightLb: 135, reps: 6 }],
      [{ weightLb: 135, reps: 7 }],
    ];
    assert.equal(detectStall(history, block), true);
  });

  test('only the most recent session below repMin is not yet a stall', () => {
    const history = [
      [{ weightLb: 135, reps: 9 }],
      [{ weightLb: 135, reps: 6 }],
    ];
    assert.equal(detectStall(history, block), false);
  });

  test('a mixed session (one set below repMin, one at/above) is not a stall', () => {
    const history = [
      [{ weightLb: 135, reps: 6 }, { weightLb: 135, reps: 9 }],
      [{ weightLb: 135, reps: 6 }, { weightLb: 135, reps: 9 }],
    ];
    assert.equal(detectStall(history, block), false);
  });
});

describe('computeTarget: stall recovery takes priority over the normal rules', () => {
  test('returns a reduced weight and stalled:true after 2 sub-repMin sessions', () => {
    const history = [
      [{ weightLb: 135, reps: 6 }],
      [{ weightLb: 135, reps: 6 }],
    ];
    const target = computeTarget(history, block);
    assert.equal(target.stalled, true);
    assert.equal(target.reps, block.repMin);
    assert.ok(target.weightLb < 135);
  });
});

describe('stallRecoveryWeight', () => {
  test('reduces by roughly 7.5%, rounded to the nearest 5 lb', () => {
    assert.equal(stallRecoveryWeight(135), 125); // 135*0.925=124.875 -> 125
    assert.equal(stallRecoveryWeight(100), 95);  // 100*0.925=92.5 -> round half up -> nearest 5 = 95
  });

  test('never goes below 5 lb', () => {
    assert.equal(stallRecoveryWeight(5), 5);
  });
});
