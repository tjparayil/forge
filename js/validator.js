// js/validator.js
// Deterministic guardrail checks (handover Section 5.3). Pure functions:
// given a program + the proposed change, return {valid, errors[]}. This is
// the gate between a pasted agent response and the diff/approve screen --
// nothing an agent proposes ever reaches the diff screen without passing
// through here first, and nothing here ever writes to the plan itself.
//
// Two guardrails from the seed are deliberately NOT enforced here, with
// reasons:
//   - maxLoadJumpPct (10%): weekOverrides in this app only ever change
//     sets/reps/exercise identity/schedule -- never a prescribed weight.
//     Load itself is entered per-set during logging and progressed by
//     js/progression.js, not proposed by the Program Designer. There is
//     nothing for this cap to check yet.
//   - minRirCompounds: RIR is a program-authored field, not currently an
//     overridable one (no op touches it), so this check is a no-op safety
//     net today. It is still implemented so it starts working the moment
//     a future op type touches RIR, without anyone having to remember to
//     add it then.
//
// One judgment call, since the seed doesn't fully disambiguate it: the
// seed's own baseWeekDirectSets shows several muscles intentionally below
// minDirectSetsPerMajorMusclePerWeek (upper_back=3, rear_delts=2, abs=2) --
// so a literal "every muscle must have >=6 sets" reading would fail the
// unmodified base program against its own guardrail. Interpreted instead
// as a no-regression floor: a change may not drop a muscle that currently
// meets the floor back below it, but does not demand muscles that are
// intentionally minimal (indirect work only) suddenly meet it.

import { resolveWeek } from './program.js';
import { computeVolume } from './volume.js';

const ALLOWED_OPS = ['set_sets', 'set_reps', 'swap_exercise', 'move_day'];

function parseMinRir(rirStr) {
  const m = /(\d+)/.exec(String(rirStr ?? ''));
  return m ? parseInt(m[1], 10) : null;
}

/** Structural checks only -- shape/types, before any guardrail math runs. */
function checkProgramDesignerShape(program, proposal) {
  const errors = [];
  if (!proposal || typeof proposal !== 'object') return ['Response is not a JSON object.'];
  if (typeof proposal.weekNumber !== 'number') errors.push('weekNumber is missing or not a number.');
  if (!Array.isArray(proposal.changes) || proposal.changes.length === 0) errors.push('changes must be a non-empty array.');
  if (typeof proposal.rationale !== 'string' || !proposal.rationale.trim()) errors.push('rationale is missing.');
  if (errors.length) return errors;

  const exerciseIds = new Set(program.exerciseLibrary.map(e => e.id));
  proposal.changes.forEach((change, i) => {
    if (!change || typeof change !== 'object') { errors.push(`changes[${i}]: not an object.`); return; }
    if (!ALLOWED_OPS.includes(change.op)) { errors.push(`changes[${i}]: unknown op "${change.op}".`); return; }
    if (change.op === 'move_day') {
      if (!change.fields?.day || !change.fields?.sessionId) errors.push(`changes[${i}]: move_day needs fields.day and fields.sessionId.`);
      return;
    }
    if (!change.sessionId) errors.push(`changes[${i}]: missing sessionId.`);
    if (!change.exerciseId) errors.push(`changes[${i}]: missing exerciseId.`);
    if (change.op === 'set_sets' && !(change.fields?.sets > 0)) errors.push(`changes[${i}]: set_sets needs fields.sets > 0.`);
    if (change.op === 'set_reps' && !(change.fields?.repMin > 0 && change.fields?.repMax >= change.fields?.repMin)) {
      errors.push(`changes[${i}]: set_reps needs fields.repMin <= fields.repMax, both > 0.`);
    }
    if (change.op === 'swap_exercise') {
      if (!exerciseIds.has(change.fields?.newExerciseId)) {
        errors.push(`changes[${i}]: newExerciseId "${change.fields?.newExerciseId}" is not in the exercise library. Add it to data/program.json first, then retry.`);
      }
    }
  });
  return errors;
}

/**
 * Validate a Program Designer proposal against this app's deterministic
 * guardrails. `overrides` is the full list of existing weekOverride
 * records (any week; only the targeted week's are used) so the "before"
 * state reflects anything already approved for that week.
 */
export function validateProgramDesignerOutput(program, overrides, proposal) {
  const shapeErrors = checkProgramDesignerShape(program, proposal);
  if (shapeErrors.length) return { valid: false, errors: shapeErrors };

  if (proposal.weekNumber < 1 || proposal.weekNumber > program.meta.totalWeeks) {
    return { valid: false, errors: [`Week ${proposal.weekNumber} is out of range (1-${program.meta.totalWeeks}).`] };
  }

  let before, after;
  try {
    before = resolveWeek(program, proposal.weekNumber, overrides);
    after = resolveWeek(program, proposal.weekNumber, [...overrides, { weekNumber: proposal.weekNumber, changes: proposal.changes }]);
  } catch (err) {
    return { valid: false, errors: [`Could not resolve week ${proposal.weekNumber}: ${err.message}`] };
  }

  const errors = [];

  for (const session of after.sessions) {
    if (session.estMinutes > program.guardrails.maxSessionMinutes) {
      errors.push(`${session.title} would take ~${session.estMinutes} min, over the ${program.guardrails.maxSessionMinutes}-min cap.`);
    }
  }

  const volBefore = computeVolume(program, before);
  const volAfter = computeVolume(program, after);
  for (const muscle of program.muscles) {
    if (volAfter[muscle].direct > program.guardrails.maxDirectSetsPerMusclePerWeek) {
      errors.push(`${muscle}: ${volAfter[muscle].direct} direct sets exceeds the ${program.guardrails.maxDirectSetsPerMusclePerWeek}-set cap.`);
    }
    if (volBefore[muscle].direct >= program.guardrails.minDirectSetsPerMajorMusclePerWeek
      && volAfter[muscle].direct < program.guardrails.minDirectSetsPerMajorMusclePerWeek) {
      errors.push(`${muscle}: would drop to ${volAfter[muscle].direct} direct sets, below the ${program.guardrails.minDirectSetsPerMajorMusclePerWeek}-set floor it currently meets.`);
    }
  }

  for (const liftId of program.meta.priorityLifts || []) {
    const freq = after.sessions.filter(s => s.blocks.some(b => b.exerciseId === liftId)).length;
    if (freq < (program.guardrails.priorityLiftMinWeeklyFrequency || 0)) {
      const ex = program.exerciseLibrary.find(e => e.id === liftId);
      errors.push(`${ex ? ex.name : liftId} would only appear ${freq}x/week, below the required ${program.guardrails.priorityLiftMinWeeklyFrequency}x/week.`);
    }
  }

  for (const session of after.sessions) {
    for (const b of session.blocks) {
      const ex = program.exerciseLibrary.find(e => e.id === b.exerciseId);
      if (!ex || ex.pattern === 'isolation') continue;
      const minRir = parseMinRir(b.rir);
      if (minRir !== null && minRir < program.guardrails.minRirCompounds) {
        errors.push(`${ex.name}: RIR ${b.rir} is below the compound floor of ${program.guardrails.minRirCompounds}.`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

/** Handover Section 5.2: nutrition changes limited to +/-150 kcal per 2 weeks. */
const NUTRITION_KCAL_CAP = 150;

// Sanity bounds for a one-time STARTING estimate (no existing baseline) --
// generous enough to cover any realistic adult, just to catch an obviously
// wrong or hallucinated number. Not from the handover; a judgment call.
const STARTING_KCAL_MIN = 1200;
const STARTING_KCAL_MAX = 6000;

/**
 * @param hasExistingBaseline - whether meta.nutritionTarget.kcalTarget is
 *   already set. The +/-150 cap (Section 7: adjustments every 2 weeks)
 *   only applies to changing an EXISTING baseline -- establishing the
 *   first one is a one-time estimate, not a "change", so it gets a much
 *   wider sanity range instead.
 */
export function validateNutritionOutput(program, proposal, hasExistingBaseline) {
  if (!proposal || typeof proposal !== 'object') return { valid: false, errors: ['Response is not a JSON object.'] };
  const errors = [];
  if (typeof proposal.kcalChange !== 'number') errors.push('kcalChange is missing or not a number.');
  if (typeof proposal.proteinTargetG !== 'number') errors.push('proteinTargetG is missing or not a number.');
  if (typeof proposal.reason !== 'string' || !proposal.reason.trim()) errors.push('reason is missing.');
  if (errors.length) return { valid: false, errors };

  if (hasExistingBaseline) {
    if (Math.abs(proposal.kcalChange) > NUTRITION_KCAL_CAP) {
      errors.push(`kcalChange of ${proposal.kcalChange} exceeds the +/-${NUTRITION_KCAL_CAP} kcal per 2-week cap.`);
    }
  } else if (proposal.kcalChange < STARTING_KCAL_MIN || proposal.kcalChange > STARTING_KCAL_MAX) {
    errors.push(`Starting estimate of ${proposal.kcalChange} kcal is outside a plausible ${STARTING_KCAL_MIN}-${STARTING_KCAL_MAX} kcal/day range.`);
  }
  const range = program.nutrition?.proteinTargetGPerDay;
  if (range && (proposal.proteinTargetG < range.min || proposal.proteinTargetG > range.max)) {
    errors.push(`proteinTargetG of ${proposal.proteinTargetG} is outside the ${range.min}-${range.max} g/day range.`);
  }
  return { valid: errors.length === 0, errors };
}

/** Weekly Review and Research outputs are informational -- shape checks only, no guardrail math. */
export function validateWeeklyReviewOutput(json) {
  if (!json || typeof json !== 'object') return { valid: false, errors: ['Response is not a JSON object.'] };
  const errors = [];
  for (const field of ['liftsProgressing', 'liftsStalled', 'painFlags', 'suggestions']) {
    if (!Array.isArray(json[field])) errors.push(`${field} must be an array.`);
  }
  if (typeof json.adherencePct !== 'number') errors.push('adherencePct is missing or not a number.');
  if (typeof json.deloadRecommended !== 'boolean') errors.push('deloadRecommended is missing or not a boolean.');
  return { valid: errors.length === 0, errors };
}

export function validateResearchOutput(json) {
  if (!json || typeof json !== 'object' || !Array.isArray(json.candidates)) {
    return { valid: false, errors: ['Response must be a JSON object with a candidates array.'] };
  }
  const errors = [];
  json.candidates.forEach((c, i) => {
    if (!c || typeof c !== 'object') { errors.push(`candidates[${i}]: not an object.`); return; }
    if (!c.name) errors.push(`candidates[${i}]: missing name.`);
    if (!Array.isArray(c.citations) || c.citations.length === 0) {
      errors.push(`candidates[${i}] (${c.name || '?'}): needs at least 1 citation.`);
    }
  });
  return { valid: errors.length === 0, errors };
}
