import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  validateProgramDesignerOutput,
  validateNutritionOutput,
  validateWeeklyReviewOutput,
  validateResearchOutput,
} from '../js/validator.js';

let program;
before(() => {
  program = JSON.parse(readFileSync(new URL('../data/program.json', import.meta.url)));
});

describe('validateProgramDesignerOutput: shape checks', () => {
  test('rejects a non-object', () => {
    const r = validateProgramDesignerOutput(program, [], null);
    assert.equal(r.valid, false);
  });

  test('rejects missing weekNumber/changes/rationale', () => {
    const r = validateProgramDesignerOutput(program, [], {});
    assert.equal(r.valid, false);
    assert.ok(r.errors.some(e => e.includes('weekNumber')));
    assert.ok(r.errors.some(e => e.includes('changes')));
    assert.ok(r.errors.some(e => e.includes('rationale')));
  });

  test('rejects an unknown op', () => {
    const r = validateProgramDesignerOutput(program, [], {
      weekNumber: 1, rationale: 'test',
      changes: [{ op: 'delete_everything', sessionId: 'FBA', exerciseId: 'bb_back_squat' }],
    });
    assert.equal(r.valid, false);
    assert.ok(r.errors.some(e => e.includes('unknown op')));
  });

  test('rejects swap_exercise to an exerciseId not in the library', () => {
    const r = validateProgramDesignerOutput(program, [], {
      weekNumber: 1, rationale: 'test',
      changes: [{ op: 'swap_exercise', sessionId: 'FBA', exerciseId: 'bb_back_squat', fields: { newExerciseId: 'made_up_exercise' } }],
    });
    assert.equal(r.valid, false);
    assert.ok(r.errors.some(e => e.includes('not in the exercise library')));
  });

  test('rejects an out-of-range week number', () => {
    const r = validateProgramDesignerOutput(program, [], {
      weekNumber: 99, rationale: 'test',
      changes: [{ op: 'set_sets', sessionId: 'FBA', exerciseId: 'bb_back_squat', fields: { sets: 4 } }],
    });
    assert.equal(r.valid, false);
    assert.ok(r.errors.some(e => e.includes('out of range')));
  });
});

describe('validateProgramDesignerOutput: guardrails', () => {
  test('accepts a small, reasonable change', () => {
    const r = validateProgramDesignerOutput(program, [], {
      weekNumber: 3, rationale: 'Bump lateral raise sets, still progressing.',
      changes: [{ op: 'set_sets', sessionId: 'FBA', exerciseId: 'cable_lateral_raise', fields: { sets: 4 } }],
    });
    assert.equal(r.valid, true, JSON.stringify(r.errors));
  });

  test('rejects a change that pushes a session over the 60-minute cap', () => {
    const r = validateProgramDesignerOutput(program, [], {
      weekNumber: 1, rationale: 'test',
      changes: [{ op: 'set_sets', sessionId: 'FBA', exerciseId: 'bb_back_squat', fields: { sets: 12 } }],
    });
    assert.equal(r.valid, false);
    assert.ok(r.errors.some(e => e.includes('min cap')));
  });

  test('rejects a change that pushes a muscle over the 20-set cap', () => {
    // Baseline quads = 10 (FBA squat 4 + FBC squat 3 + leg_press 3). Bumping
    // FBA's squat to 20 sets brings quads to 26, well over the cap.
    const r = validateProgramDesignerOutput(program, [], {
      weekNumber: 1, rationale: 'test',
      changes: [{ op: 'set_sets', sessionId: 'FBA', exerciseId: 'bb_back_squat', fields: { sets: 20 } }],
    });
    assert.equal(r.valid, false);
    assert.ok(r.errors.some(e => e.includes('quads') && e.includes('exceeds')));
  });

  test('rejects a change that drops a major muscle below its current floor', () => {
    // chest sits at 10 direct sets in week 1; dropping bb_bench to 0 sets
    // isn't representable via set_sets (must stay > 0), so drop indirectly
    // via a swap that removes a chest-contributing exercise instead: swap
    // bb_bench (chest) for a non-chest exercise on FBA.
    const r = validateProgramDesignerOutput(program, [], {
      weekNumber: 1, rationale: 'test',
      changes: [
        { op: 'swap_exercise', sessionId: 'FBA', exerciseId: 'bb_bench', fields: { newExerciseId: 'seated_cable_row' } },
        { op: 'swap_exercise', sessionId: 'FBC', exerciseId: 'bb_bench', fields: { newExerciseId: 'seated_cable_row' } },
      ],
    });
    assert.equal(r.valid, false);
    assert.ok(r.errors.some(e => e.includes('chest') && e.includes('floor')));
  });

  test('does not fail on a muscle that is intentionally below the floor at baseline (upper_back)', () => {
    // upper_back is only 3 direct sets at baseline -- must not be flagged
    // just for existing below 6, since it never met the floor to begin with.
    const r = validateProgramDesignerOutput(program, [], {
      weekNumber: 3, rationale: 'test',
      changes: [{ op: 'set_reps', sessionId: 'FBB', exerciseId: 'cs_db_row', fields: { repMin: 8, repMax: 10 } }],
    });
    assert.equal(r.valid, true, JSON.stringify(r.errors));
  });

  test('rejects dropping a priority lift below its required weekly frequency', () => {
    // bb_back_squat appears in both FBA and FBC; swapping it out of both drops frequency to 0.
    const r = validateProgramDesignerOutput(program, [], {
      weekNumber: 1, rationale: 'test',
      changes: [
        { op: 'swap_exercise', sessionId: 'FBA', exerciseId: 'bb_back_squat', fields: { newExerciseId: 'leg_press' } },
        { op: 'swap_exercise', sessionId: 'FBC', exerciseId: 'bb_back_squat', fields: { newExerciseId: 'leg_press' } },
      ],
    });
    assert.equal(r.valid, false);
    assert.ok(r.errors.some(e => e.includes('Barbell back squat') && e.includes('below the required')));
  });

  test('a valid proposal for a later week (with existing overrides passed in) still resolves correctly', () => {
    const existingOverride = { weekNumber: 5, changes: [{ op: 'set_sets', sessionId: 'FBA', exerciseId: 'cable_lateral_raise', fields: { sets: 2 } }] };
    const r = validateProgramDesignerOutput(program, [existingOverride], {
      weekNumber: 5, rationale: 'test',
      changes: [{ op: 'set_reps', sessionId: 'FBA', exerciseId: 'cable_lateral_raise', fields: { repMin: 12, repMax: 15 } }],
    });
    assert.equal(r.valid, true, JSON.stringify(r.errors));
  });
});

describe('validateNutritionOutput', () => {
  test('accepts a change within the cap and protein range', () => {
    const r = validateNutritionOutput(program, { kcalChange: 100, proteinTargetG: 150, reason: 'Weight gain trending under target.' });
    assert.equal(r.valid, true, JSON.stringify(r.errors));
  });

  test('rejects a kcalChange over the +/-150 cap', () => {
    const r = validateNutritionOutput(program, { kcalChange: 300, proteinTargetG: 145, reason: 'test' });
    assert.equal(r.valid, false);
    assert.ok(r.errors.some(e => e.includes('150 kcal')));
  });

  test('rejects a negative kcalChange over the cap too', () => {
    const r = validateNutritionOutput(program, { kcalChange: -200, proteinTargetG: 145, reason: 'test' });
    assert.equal(r.valid, false);
  });

  test('rejects a protein target outside the seed range', () => {
    const r = validateNutritionOutput(program, { kcalChange: 0, proteinTargetG: 300, reason: 'test' });
    assert.equal(r.valid, false);
    assert.ok(r.errors.some(e => e.includes('g/day range')));
  });

  test('rejects missing fields', () => {
    const r = validateNutritionOutput(program, { reason: 'test' });
    assert.equal(r.valid, false);
  });
});

describe('validateWeeklyReviewOutput', () => {
  test('accepts a well-formed review', () => {
    const r = validateWeeklyReviewOutput({
      adherencePct: 100, liftsProgressing: ['Barbell back squat'], liftsStalled: [],
      painFlags: [], deloadRecommended: false, suggestions: [],
    });
    assert.equal(r.valid, true, JSON.stringify(r.errors));
  });

  test('rejects missing array fields', () => {
    const r = validateWeeklyReviewOutput({ adherencePct: 50, deloadRecommended: false });
    assert.equal(r.valid, false);
  });
});

describe('validateResearchOutput', () => {
  test('accepts candidates with citations', () => {
    const r = validateResearchOutput({ candidates: [{ name: 'Goblet squat', citations: [{ url: 'https://exrx.net/x', title: 'x' }] }] });
    assert.equal(r.valid, true, JSON.stringify(r.errors));
  });

  test('rejects a candidate with no citations', () => {
    const r = validateResearchOutput({ candidates: [{ name: 'Goblet squat', citations: [] }] });
    assert.equal(r.valid, false);
    assert.ok(r.errors.some(e => e.includes('citation')));
  });

  test('rejects a non-array candidates field', () => {
    const r = validateResearchOutput({ candidates: 'not an array' });
    assert.equal(r.valid, false);
  });
});
