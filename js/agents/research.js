// js/agents/research.js
// Research agent: no API call, no in-app web search tool. buildPrompt()
// asks Claude (via whatever web-search capability the conversation you
// paste it into has -- claude.ai, Claude Code, etc.) to answer one
// specific question with cited candidates. The pasted JSON response is
// validated by js/validator.js's validateResearchOutput.

export const id = 'research';
export const label = 'Research a question';
export const description = 'Answers one specific question (e.g. an exercise swap) with cited sources. Feed its candidates into Program Designer.';

// Handover Section 5.5, unchanged -- a preference, not an enforced allowlist
// (this app has no server-side tool config to enforce it with).
export const SUGGESTED_DOMAINS = [
  'pubmed.ncbi.nlm.nih.gov', 'pmc.ncbi.nlm.nih.gov', 'link.springer.com',
  'bjsm.bmj.com', 'tandfonline.com', 'journals.lww.com', 'sportrxiv.org',
  'jissn.biomedcentral.com', 'strongerbyscience.com', 'exrx.net',
];

const INSTRUCTIONS = `You are the Research agent for Forge, a personal hypertrophy training app.
Use web search to answer the specific question below, then reply with ONLY a JSON object (no prose before or after, no markdown code fence) in exactly this shape:

{
  "candidates": [
    {
      "name": "",
      "equipment": "barbell",
      "primary": [],
      "secondary": [],
      "setup": "",
      "move": "",
      "avoid": "",
      "citations": [{ "url": "", "title": "" }]
    }
  ]
}

Field rules:
- equipment is one of: barbell, dumbbell, cable, machine, bodyweight.
- primary/secondary use muscle names from this list: chest, lats, upper_back, front_delts, side_delts, rear_delts, biceps, triceps, quads, hamstrings, glutes, adductors, calves, abs.
- setup/move/avoid are one sentence each, in your own words -- never copy source text verbatim.
- Every candidate needs at least 1 citation with a real URL you found via search. No citation, no candidate.
- Prefer these domains when they cover the topic: ${SUGGESTED_DOMAINS.join(', ')}. Other reputable sources (established coaching sites, peer-reviewed journals) are fine when these don't cover it.`;

export function buildPrompt(ctx) {
  return `${INSTRUCTIONS}

--- QUESTION ---
${ctx.question}
--- END QUESTION ---`;
}
