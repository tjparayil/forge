// js/progression.js
// Double progression targets and stall detection (handover Section 6.5).
// Pure functions: caller fetches setLogs from the store and groups them
// into per-session working-set arrays before calling these.

/**
 * @param {Array<Array<{weightLb:number, reps:number}>>} sessionsHistory
 *   Working sets (weightLb>0, reps>0) grouped by session, oldest first,
 *   most recent last. Non-working (skipped) sets should already be
 *   filtered out by the caller.
 * @param {{repMin:number, repMax:number}} block - this week's resolved block for the exercise
 * @returns {{weightLb:number, reps:number, stalled:boolean, note:string}|null}
 */
export function computeTarget(sessionsHistory, block) {
  if (!sessionsHistory || sessionsHistory.length === 0) return null;
  const last = sessionsHistory[sessionsHistory.length - 1];
  if (!last || last.length === 0) return null;

  if (detectStall(sessionsHistory, block)) {
    const lastWeight = Math.max(...last.map(s => s.weightLb));
    return {
      weightLb: stallRecoveryWeight(lastWeight),
      reps: block.repMin,
      stalled: true,
      note: 'Reps stalled below the rep range for 2 sessions in a row. Drop the weight and rebuild.',
    };
  }

  const allAtOrAboveMax = last.every(s => s.reps >= block.repMax);
  const maxWeight = Math.max(...last.map(s => s.weightLb));
  if (allAtOrAboveMax) {
    return {
      weightLb: maxWeight + 5,
      reps: block.repMin,
      stalled: false,
      note: 'Every set hit the top of the rep range last time. Add load.',
    };
  }

  const minReps = Math.min(...last.map(s => s.reps));
  return {
    weightLb: maxWeight,
    reps: Math.min(block.repMax, minReps + 1),
    stalled: false,
    note: 'Same weight, aim for one more rep.',
  };
}

/** Reps fell below repMin for the last 2 sessions in a row (handover Section 6.5: "Stall"). */
export function detectStall(sessionsHistory, block) {
  if (!sessionsHistory || sessionsHistory.length < 2) return false;
  const lastTwo = sessionsHistory.slice(-2);
  return lastTwo.every(sets => sets.length > 0 && sets.every(s => s.reps < block.repMin));
}

/** Reduce load 5-10% (midpoint 7.5%), rounded to the nearest 5 lb, minimum 5 lb. */
export function stallRecoveryWeight(lastWeight) {
  return Math.max(5, Math.round((lastWeight * 0.925) / 5) * 5);
}
