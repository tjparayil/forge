// js/agents/nutrition.js
// Nutrition agent: proposes a calorie/protein adjustment. No API call.
// Works even before Phase 5 adds body logging (recentBodyLogs may be
// empty) -- the prompt tells Claude to say so and propose no change
// rather than guess.

export const id = 'nutrition';
export const label = 'Nutrition check-in';
export const description = 'Proposes a calorie/protein adjustment from your weigh-in trend, capped at +/-150 kcal per 2 weeks.';

const INSTRUCTIONS = `You are the Nutrition agent for Forge, a personal hypertrophy training app.
Reply with ONLY a JSON object (no prose before or after, no markdown code fence) in exactly this shape:

{
  "kcalChange": 0,
  "proteinTargetG": 0,
  "reason": ""
}

Field rules:
- kcalChange must be between -150 and +150 (this is a per-2-week adjustment cap, not a daily total).
- proteinTargetG must stay within the athlete's protein range given below.
- reason is 1-3 sentences and must reference the trend data or phase below. If there is no weigh-in trend yet, say so explicitly and propose kcalChange: 0.`;

export function buildPrompt(ctx) {
  return `${INSTRUCTIONS}

--- CONTEXT ---
Nutrition phase: ${ctx.nutritionPhase}
Protein range: ${ctx.proteinMin}-${ctx.proteinMax} g/day (current target ${ctx.currentProteinTarget}g)
Athlete: height ${ctx.heightIn} in, starting weight ${ctx.startWeightLb} lb, age ${ctx.age ?? 'unknown'}

Recent body log (most recent last; may be empty if none logged yet):
${JSON.stringify(ctx.recentBodyLogs, null, 2)}
--- END CONTEXT ---`;
}
