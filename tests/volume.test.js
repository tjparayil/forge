import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { computeVolume, flagVolumeOutOfRange } from '../js/volume.js';
import { resolveWeek } from '../js/program.js';

let program;
before(() => {
  program = JSON.parse(readFileSync(new URL('../data/program.json', import.meta.url)));
});

describe('computeVolume: week 1 (unmodified base week)', () => {
  test('direct sets match the seed\'s own baseWeekDirectSets table exactly, muscle by muscle', () => {
    const week1 = resolveWeek(program, 1);
    const volume = computeVolume(program, week1);
    const expected = program.baseWeekDirectSets;
    for (const muscle of Object.keys(expected)) {
      if (muscle === 'note') continue;
      assert.equal(
        volume[muscle].direct,
        expected[muscle],
        `${muscle}: expected ${expected[muscle]} direct sets, computed ${volume[muscle].direct}`
      );
    }
  });

  test('a dual-primary exercise (chest-supported row: upper_back + lats) counts fully toward both', () => {
    const week1 = resolveWeek(program, 1);
    const volume = computeVolume(program, week1);
    // cs_db_row is FBB's only upper_back contributor, at 3 sets (week 1).
    assert.equal(volume.upper_back.direct, 3);
    // lats also gets the 3 from cs_db_row, on top of the two lat pulldowns.
    assert.equal(volume.lats.direct, 9);
  });

  test('secondary muscles accumulate fractional (0.5-weighted) sets, separate from direct', () => {
    const week1 = resolveWeek(program, 1);
    const volume = computeVolume(program, week1);
    // triceps is secondary on bb_bench (FBA 3 + FBC 4) and db_incline_press
    // (FBB 3) = 10 sets, plus direct sets from cable_pushdown/overhead_cable_ext (2+2=4).
    assert.equal(volume.triceps.direct, 4);
    assert.equal(volume.triceps.fractional, 5); // 10 * 0.5
    assert.equal(volume.triceps.total, 9);
  });
});

describe('computeVolume: scales with the block (week 17, +1 tagged set)', () => {
  test('side_delts volume rises because cable_lateral_raise and db_lateral_raise are both tagged', () => {
    const week1 = resolveWeek(program, 1);
    const week17 = resolveWeek(program, 17);
    const v1 = computeVolume(program, week1);
    const v17 = computeVolume(program, week17);
    assert.equal(v1.side_delts.direct, 6);
    assert.equal(v17.side_delts.direct, 8); // both tagged exercises +1 each
  });
});

describe('flagVolumeOutOfRange', () => {
  test('flags a muscle below the guardrail minimum as under', () => {
    const fakeVolume = { chest: { direct: 2, fractional: 0, total: 2 } };
    const fakeProgram = { guardrails: { minDirectSetsPerMajorMusclePerWeek: 6, maxDirectSetsPerMusclePerWeek: 20 } };
    assert.equal(flagVolumeOutOfRange(fakeProgram, fakeVolume).chest, 'under');
  });

  test('flags a muscle above the guardrail maximum as over', () => {
    const fakeVolume = { chest: { direct: 25, fractional: 0, total: 25 } };
    const fakeProgram = { guardrails: { minDirectSetsPerMajorMusclePerWeek: 6, maxDirectSetsPerMusclePerWeek: 20 } };
    assert.equal(flagVolumeOutOfRange(fakeProgram, fakeVolume).chest, 'over');
  });

  test('week 1 program volume is within guardrails for every muscle', () => {
    const week1 = resolveWeek(program, 1);
    const volume = computeVolume(program, week1);
    const flags = flagVolumeOutOfRange(program, volume);
    for (const [muscle, flag] of Object.entries(flags)) {
      assert.notEqual(flag, 'over', `${muscle} is over the guardrail max`);
    }
  });
});
