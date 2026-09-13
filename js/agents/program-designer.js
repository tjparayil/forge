// js/agents/program-designer.js
// Program Designer agent: proposes a weekOverride for ONE week. No API
// call. The output shape here is deliberately identical to what the Plan
// screen's manual editor already produces (js/plan-screen.js) and what
// js/program.js's resolveWeek() already knows how to apply -- an agent
// proposal and a manual edit are the same kind of record, gated the same
// way, all the way down to the same undo history.

export const id = 'program-designer';
export const label = 'Design next week';
export const description = 'Proposes specific changes to one week (sets, reps, exercise swaps, day moves). Every proposal is validated before you ever see a diff.';

const INSTRUCTIONS = `You are the Program Designer agent for Forge, a personal hypertrophy training app.
Propose changes to ONE week of the plan. Reply with ONLY a JSON object (no prose before or after, no markdown code fence) in exactly this shape:

{
  "weekNumber": 0,
  "changes": [
    { "op": "set_sets", "sessionId": "FBA", "exerciseId": "", "fields": { "sets": 0 } },
    { "op": "set_reps", "sessionId": "FBA", "exerciseId": "", "fields": { "repMin": 0, "repMax": 0 } },
    { "op": "swap_exercise", "sessionId": "FBA", "exerciseId": "", "fields": { "newExerciseId": "" } },
    { "op": "move_day", "fields": { "day": "mon", "sessionId": "FBA" } }
  ],
  "rationale": ""
}

Field rules:
- op is exactly one of: set_sets, set_reps, swap_exercise, move_day. Include only the fields shown for whichever op you use.
- sessionId is one of the session ids in this week's current plan below (e.g. FBA, FBB, FBC).
- exerciseId (the one being changed) and fields.newExerciseId (for swap_exercise) must be ids from the exercise library below. Never invent an id. If the exercise you want isn't in the library, do not propose it -- say so in rationale instead.
- move_day's fields.day is one of: mon, tue, wed, thu, fri, sat, sun. Its fields.sessionId is a session id, or "rest", or "cardio_or_basketball".
- rationale is 2-4 sentences and must reference the review/research context below, not generic advice.
- Make the smallest change that addresses the findings -- do not rewrite the whole week.
- Do not exceed a 60-minute estimated session time for any session you touch.
- Do not push any muscle's weekly direct sets above 20, and do not drop a muscle below the floor it currently meets.
- Keep the priority lifts at their current weekly frequency or higher.

Your proposal will be checked by code against these exact rules before a human ever sees it -- if you are unsure a change passes, propose a smaller one.`;

export function buildPrompt(ctx) {
  return `${INSTRUCTIONS}

--- CONTEXT ---
Week to modify: ${ctx.weekNumber} (${ctx.blockName} block)
Guardrails: ${JSON.stringify(ctx.guardrails, null, 2)}

This week's current resolved plan:
${JSON.stringify(ctx.resolvedWeek, null, 2)}

Exercise library (id, name, equipment, pattern, primary/secondary muscles):
${JSON.stringify(ctx.exerciseLibrarySummary, null, 2)}

Weekly Review findings (if any):
${ctx.reviewFindings ? JSON.stringify(ctx.reviewFindings, null, 2) : 'None provided.'}

Research candidates (if any):
${ctx.researchCandidates ? JSON.stringify(ctx.researchCandidates, null, 2) : 'None provided.'}
--- END CONTEXT ---`;
}
