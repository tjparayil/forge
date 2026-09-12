// js/program.js
// Program engine: resolves any week of the 31-week block into concrete
// sessions (sets/reps/rest), derives the current week from the start date,
// and applies user-approved week-scoped overrides (manual edits for now,
// AI-agent proposals later -- same code path either way).
//
// Plain ES module, no dependencies. Pure functions only (no fetch, no
// storage) so this is fully unit-testable with node --test.

import { parseLocalDateStr } from './store.js';

// ---------- Week <-> date ----------

/** Which block (base/build/deload/...) a given week number belongs to. */
export function blockForWeek(program, weekNumber) {
  return program.blocks.find(b => b.weeks.includes(weekNumber)) || null;
}

/**
 * Derive the current week number from the program's start date and a given
 * "today". Clamped to [1, totalWeeks] -- so a week counter for this 31-week
 * block never reports "week 45" the way the old 52-week app's cap would
 * have let it after the block ends.
 */
export function weekNumberForDate(program, today = new Date()) {
  const start = parseLocalDateStr(program.meta.startDate);
  if (!start) throw new Error(`Invalid program.meta.startDate: ${program.meta.startDate}`);
  const todayMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const diffDays = Math.floor((todayMidnight - start) / 86400000);
  const week = Math.floor(diffDays / 7) + 1;
  return Math.max(1, Math.min(program.meta.totalWeeks, week));
}

// ---------- Session time estimate ----------
// Matches the method described in the handover (Section 6.3): sets x (40s
// work + rest) + 10 min warmup/transitions, with superset members sharing
// one rest per round. Validated against the seed's authored estMinutes for
// all 3 week-1 sessions (57, 57, 55) -- see tests/program.test.js.

const WORK_SECONDS_PER_SET = 40;
const WARMUP_TRANSITION_SECONDS = 10 * 60;

export function estimateSessionMinutes(session) {
  const groups = new Map(); // supersetGroup key (or unique per-block key for solo blocks) -> blocks[]
  session.blocks.forEach((b, i) => {
    const key = b.supersetGroup ? `group:${b.supersetGroup}` : `solo:${i}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(b);
  });
  let totalSeconds = 0;
  for (const members of groups.values()) {
    const workSeconds = members.reduce((sum, b) => sum + b.sets * WORK_SECONDS_PER_SET, 0);
    const maxSets = Math.max(...members.map(b => b.sets));
    const restSec = members[0].restSec; // superset members share rest in this program's data
    totalSeconds += workSeconds + restSec * maxSets;
  }
  return Math.round((totalSeconds + WARMUP_TRANSITION_SECONDS) / 60);
}

// ---------- Overrides ----------
// A week override is { weekNumber, sessionId, changes: [...], createdBy,
// approvedAt, rationale }. Each change is one of:
//   { op: 'set_sets', exerciseId, fields: { sets } }
//   { op: 'set_reps', exerciseId, fields: { repMin, repMax } }
//   { op: 'swap_exercise', exerciseId, fields: { newExerciseId, restSec? } }
//   { op: 'move_day', fields: { day, sessionId } }  -- day is 'mon'..'sun'
// These are the same shape whether a human edits them in the week editor or
// an approved AI proposal writes them (Phase 4) -- the validator/diff screen
// gate is upstream of this function either way; resolveWeek just applies
// already-approved changes.

function applyBlockChangesToSession(session, changes) {
  const blocks = session.blocks.map(b => ({ ...b }));
  for (const change of changes) {
    const idx = blocks.findIndex(b => b.exerciseId === change.exerciseId);
    if (idx === -1) continue; // exercise not in this session; ignore defensively
    if (change.op === 'set_sets') {
      blocks[idx].sets = change.fields.sets;
      blocks[idx].overridden = true;
    } else if (change.op === 'set_reps') {
      blocks[idx].repMin = change.fields.repMin;
      blocks[idx].repMax = change.fields.repMax;
      blocks[idx].overridden = true;
    } else if (change.op === 'swap_exercise') {
      blocks[idx].exerciseId = change.fields.newExerciseId;
      if (change.fields.restSec) blocks[idx].restSec = change.fields.restSec;
      blocks[idx].overridden = true;
    }
  }
  return { ...session, blocks };
}

// ---------- Resolve a week ----------

/**
 * Resolve one week of the program into concrete sessions: apply the block's
 * set multiplier / tagged-set addition, then layer on any approved
 * overrides for that specific week (and only that week).
 *
 * @param {object} program - parsed data/program.json
 * @param {number} weekNumber
 * @param {object[]} overrides - weekOverride records (any week; filtered here)
 */
export function resolveWeek(program, weekNumber, overrides = []) {
  if (weekNumber < 1 || weekNumber > program.meta.totalWeeks) {
    throw new Error(`Week ${weekNumber} is out of range (1-${program.meta.totalWeeks})`);
  }
  const block = blockForWeek(program, weekNumber);
  if (!block) throw new Error(`No block covers week ${weekNumber}`);

  const changesForWeek = overrides
    .filter(o => o.weekNumber === weekNumber)
    .flatMap(o => o.changes || []);

  // Schedule: start from the program default, apply any move_day changes.
  const schedule = { ...program.schedule };
  for (const change of changesForWeek) {
    if (change.op === 'move_day') schedule[change.fields.day] = change.fields.sessionId;
  }

  const sessions = program.sessions.map(session => {
    // 1. Apply block rules (deload/taper multiplier, build's tagged-set add).
    const blockResolvedBlocks = session.blocks.map(b => {
      let sets = b.sets;
      if (block.addSetsToTagged && b.progressVolume) sets += block.addSetsToTagged;
      sets = Math.max(1, Math.round(sets * block.setMultiplier));
      return { ...b, sets, overridden: false };
    });
    let resolved = { ...session, blocks: blockResolvedBlocks };

    // 2. Apply this week's approved overrides for this session only.
    const sessionChanges = changesForWeek.filter(c => c.sessionId === session.id && c.exerciseId);
    if (sessionChanges.length) resolved = applyBlockChangesToSession(resolved, sessionChanges);

    resolved.estMinutes = estimateSessionMinutes(resolved);
    return resolved;
  });

  return {
    weekNumber,
    block: {
      id: block.id,
      name: block.name,
      setMultiplier: block.setMultiplier,
      addSetsToTagged: block.addSetsToTagged,
      rir: block.rir,
      nutritionPhase: block.nutritionPhase,
      note: block.note,
    },
    schedule,
    sessions,
  };
}
