// js/agents/weekly-review.js
// Weekly Review agent: no API call. buildPrompt() produces text to copy
// into a Claude conversation; the pasted JSON response is validated by
// js/validator.js's validateWeeklyReviewOutput before it's shown anywhere.

export const id = 'weekly-review';
export const label = 'Weekly Review';
export const description = 'Reviews recent logs for adherence, stalls, and pain flags. Read-only -- proposes nothing itself.';

const INSTRUCTIONS = `You are the Weekly Review agent for Forge, a personal hypertrophy training app.
Read the training data below and reply with ONLY a JSON object (no prose before or after, no markdown code fence) in exactly this shape:

{
  "adherencePct": 0,
  "liftsProgressing": [],
  "liftsStalled": [],
  "painFlags": [],
  "deloadRecommended": false,
  "suggestions": [{ "type": "swap", "target": "", "reason": "" }]
}

Field rules:
- adherencePct: sessions actually completed vs sessions scheduled over the period covered by the data below (0-100).
- liftsProgressing / liftsStalled: exercise names only, taken from the data below.
- painFlags: exercise names where a set was logged with a pain flag.
- deloadRecommended: true if reps dropped on 2+ priority lifts for 2 straight sessions in a row, OR pain was flagged, OR notes mention poor sleep/high stress for most of the week.
- suggestions[].type is one of: swap, volume, schedule, other. Keep suggestions conservative and specific -- one sentence each, and the reason must cite an actual number or date from the data below.

Do not invent a weight, rep count, or date that is not present in the data below.`;

export function buildPrompt(ctx) {
  return `${INSTRUCTIONS}

--- CONTEXT ---
Current block: ${ctx.blockName} (week ${ctx.weekNumber} of ${ctx.totalWeeks})
Priority lifts: ${ctx.priorityLifts.join(', ')}

Recent set logs (most recent last):
${JSON.stringify(ctx.recentSetLogs, null, 2)}

Recent session history:
${JSON.stringify(ctx.recentSessionHistory, null, 2)}

Recent notes:
${JSON.stringify(ctx.recentNotes, null, 2)}
--- END CONTEXT ---`;
}
