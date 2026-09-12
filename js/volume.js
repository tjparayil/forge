// js/volume.js
// Per-muscle weekly set volume, computed live from a resolved week (never
// hardcoded) -- matches audit item #10's requirement that the app compute
// this table itself rather than trust a stale static one. Direct sets come
// from primary-tagged exercises (weight 1.0); fractional sets come from
// secondary-tagged exercises, weighted by guardrails.secondaryMuscleSetWeight
// (0.5 in the seed). Validated in tests/volume.test.js against the seed's
// own baseWeekDirectSets table for week 1 -- matches exactly, muscle by
// muscle.

export function computeVolume(program, resolvedWeek) {
  const weight = program.guardrails?.secondaryMuscleSetWeight ?? 0.5;
  const exerciseById = new Map(program.exerciseLibrary.map(e => [e.id, e]));

  const totals = {};
  for (const muscle of program.muscles) totals[muscle] = { direct: 0, fractional: 0 };

  for (const session of resolvedWeek.sessions) {
    for (const b of session.blocks) {
      const ex = exerciseById.get(b.exerciseId);
      if (!ex) continue; // e.g. a swapped-in exercise not yet in the library; skip, don't crash
      for (const m of ex.primary || []) {
        if (totals[m]) totals[m].direct += b.sets;
      }
      for (const m of ex.secondary || []) {
        if (totals[m]) totals[m].fractional += b.sets * weight;
      }
    }
  }

  const result = {};
  for (const muscle of program.muscles) {
    const { direct, fractional } = totals[muscle];
    result[muscle] = {
      direct,
      fractional: Math.round(fractional * 100) / 100,
      total: Math.round((direct + fractional) * 100) / 100,
    };
  }
  return result;
}

/**
 * Flags muscles outside the guardrail band, purely for display -- this is
 * NOT the deterministic agent validator from Section 5.3 (that's Phase 4
 * scope, gates AI proposals). This just powers a visual under/over/in-range
 * indicator on the volume dashboard.
 */
export function flagVolumeOutOfRange(program, volume) {
  const min = program.guardrails?.minDirectSetsPerMajorMusclePerWeek ?? 6;
  const max = program.guardrails?.maxDirectSetsPerMusclePerWeek ?? 20;
  const flags = {};
  for (const [muscle, v] of Object.entries(volume)) {
    flags[muscle] = v.direct < min ? 'under' : v.direct > max ? 'over' : 'ok';
  }
  return flags;
}
