# FORGE v2 HANDOVER (for Claude Code)

Prepared: 2026-09-11 | Owner and only user: Thomas | Companion file: `forge-program-seed.json`

---

## 0. Bottom line up front

- **Goal:** Turn Forge from a hardcoded single-file tracker into a data-driven, week-by-week customizable training app with AI agents that research, propose, and adjust the plan. Must run as a static site (GitHub Pages), no server.
- **Training frequency:** 3 full-body sessions per week (Mon/Wed/Fri default), each built to about 60 minutes. Revised from an earlier 4-day upper/lower draft at Thomas's request.
- **Timeline change:** The wedding is **Saturday, April 17, 2027**, about **31 weeks** from the build date. The old app assumes a 52-week plan. The new program is a **31-week block starting Monday, September 14, 2026** (see Section 6 and the seed JSON).
- **Recommended architecture:** Static GitHub Pages app + "bring your own key" direct browser calls to the Claude API, using Anthropic's server-side web search tool as the "scraper." Every AI proposal passes a deterministic validator and a human-approved diff before it touches the plan.
- **First task for Claude Code:** The file reviewed for this handover may be **older than what is live** at `tjparayil.github.io/forge` (details in Section 2). Diff the repo's current `index.html` against this document before changing anything.

---

## 1. Context and constraints

| Item | Value |
|---|---|
| Athlete | 6'0", 165 lb, self-described average athletic ability |
| Goal | Put on muscle naturally, look lean and weight-stable for the wedding |
| Event date | Saturday, April 17, 2027 (Washington, DC) |
| Training location | Fully equipped commercial gym (barbell, rack, cables, leg press, lat pulldown, machines) |
| Training days | 3 full-body sessions per week |
| Session length | About 60 minutes each; 60 is also the hard cap |
| Priority lifts | Barbell back squat, barbell bench press |
| Preferences | Lat pulldowns over pull-ups; hypertrophy focus, mostly 8-12 reps; cardio rotates by preference (basketball, cycling, running, golf) |
| Other sport | Basketball. Pre-basketball sessions must be light primers. Dynamic, not static, stretching before explosive work. |
| Units | Pounds everywhere. 5 lb load increments. |
| Device | iPhone, used in the gym. Added to home screen as a PWA. |
| Known travel | Puerto Rico Oct 15-18, 2026 (Week 5, scheduled as a deload) |
| Unknowns | Age (needed for calorie estimate), basketball days. Ask at session start (Section 11). |

---

## 2. Audit of the file provided (`forge-gym-app.html` in the Claude.ai project)

Prior notes indicate the live app already has features this file lacks (pounds, per-set rest timers with haptics, auto-advancing week counter, cardio timer, post-workout summary, session history with backfill). **Treat the live repo as the source of truth** and use this table as a checklist.

| # | Issue in provided file | Why it matters | Fix |
|---|---|---|---|
| 1 | HTML nesting: an extra `</div>` after the Progress screen closes `.scroll`, and the Overload screen's closing tags then close `.app`. Notes/Overload screens sit outside `.scroll`; the bottom nav appears to render outside `.app` | Nav may be pushed off-screen; Notes/Overload do not scroll correctly | Rebuild layout; add a DOM structure test |
| 2 | History keyed by array index (`hist_${workoutId}_${exIdx}`) | Any week-to-week exercise swap or reorder corrupts history. Blocks the whole "dynamic plan" goal | Stable `exerciseId` keys; migration script |
| 3 | Units in kg, +2.5 kg progression | User trains in lb, 5 lb jumps | Units = lb; increments from seed |
| 4 | Dates via `toISOString().slice(0,10)` (UTC) | Evening sessions in US Eastern time log to the next day | Use local date helper |
| 5 | Week counter reads `localStorage.week`, never advances | Static "Week 1 of 52" | Derive week from `startDate` in program |
| 6 | Streak breaks on scheduled rest days | Punishes following the plan | Track "planned sessions completed this week" instead |
| 7 | `finishWorkout()` increments sessions even with nothing logged, and can double count | Inflated stats | Only count sessions with at least 1 logged set; one per workout per day |
| 8 | Note text injected with `innerHTML` unescaped | Broken rendering if text contains `<`; bad habit once AI text is rendered | Escape all user and AI text; use `textContent` |
| 9 | `.ex-cues-toggle` base style missing; Progress screen unreachable from nav | Visual/UX gaps | Restyle; fold Progress into a Stats tab |
| 10 | Hardcoded "At 175 lbs" in cardio cues; Phase 3 "cut" framing | Stale. User is 165 lb and goal is now lean gain | All athlete data from settings/program JSON |
| 11 | All data in `localStorage` only | iOS Safari may clear site storage in some conditions (verify current WebKit policy); no backup | IndexedDB wrapper + JSON export/import |

---

## 3. Architecture options

| Option | How it works | Pros | Cons | Cost |
|---|---|---|---|---|
| **A. Static + BYOK (recommended now)** | GitHub Pages serves the app. Browser calls `api.anthropic.com` directly with the user's own API key stored on-device, using the `anthropic-dangerous-direct-browser-access: true` header. Web research runs through Anthropic's server-side web search tool | No server, deploys the same way as today, Anthropic's side does the fetching (no browser CORS scraping problems) | Key lives in device storage; no scheduled background jobs (agents run when the app is open) | API usage only |
| B. Static + Cloudflare Worker proxy | Same front end; a Worker holds the key and can run on a weekly cron | Key never in the browser; weekly auto-review possible | Second system to maintain; free-tier limits must be verified | Likely free tier + API usage (verify) |
| C. Full backend (Supabase/Vercel + DB) | Server, database, auth | Multi-device sync, robust storage | Overkill for one user; most work | Varies |

**Recommendation:** Build A now, but isolate all API calls in one module (`js/api.js`) so moving to B later is a one-file change.

---

## 4. Target structure and data model

### 4.1 Files (plain ES modules, no build step unless Thomas approves)

```
/index.html
/manifest.webmanifest
/sw.js                      (offline cache; verify iOS PWA behavior)
/css/app.css
/js/app.js                  (router, screens)
/js/store.js                (IndexedDB wrapper, export/import, migrations)
/js/program.js              (week resolution: blocks x sessions x overrides)
/js/progression.js          (double progression, targets)
/js/volume.js               (weekly sets per muscle, direct + fractional)
/js/validator.js            (deterministic guardrails, pure functions)
/js/api.js                  (single place for Claude API calls)
/js/agents/*.js             (one file per agent: prompt + schema + parse)
/data/program.json          (seed, copied from forge-program-seed.json)
/tests/*.test.js            (node --test, no dependencies)
```

Note: this changes the update workflow from "paste one file into the GitHub editor" to git commits made by Claude Code. Confirm with Thomas.

### 4.2 Core entities

| Entity | Key fields |
|---|---|
| `exercise` | `id` (stable slug), `name`, `equipment`, `pattern`, `primary[]`, `secondary[]`, `defaultRestSec`, `cues{setup,move,avoid}`, `source` (seed or agent + citation) |
| `session` | `id`, `title`, `focus`, `warmup`, `blocks[]` of `{exerciseId, sets, repMin, repMax, rir, restSec, supersetGroup?, progressVolume}` |
| `block` (mesocycle) | `id`, `weeks[]`, `startDate`, `addSetsToTagged`, `setMultiplier`, `rir`, `nutritionPhase` |
| `weekOverride` | `weekNumber`, `changes[]` (swap exercise, change sets/reps, move day), `createdBy` (user or agent), `approvedAt`, `rationale`, `citations[]` |
| `programVersion` | full resolved snapshot + diff from previous, for undo |
| `setLog` | `date` (local), `sessionId`, `exerciseId`, `setIndex`, `weightLb`, `reps`, `rir`, `painFlag`, `note` |
| `bodyLog` | `date`, `weightLb`, optional `waistIn`, `kcal`, `proteinG`, `sleepH` |
| `note` | existing notes feature, plus `exerciseId?` link |
| `settings` | `apiKey` (device only), `model`, `units`, `basketballDays[]`, `age`, `monthlyBudgetUsd`, `allowedDomains[]` |

### 4.3 Week resolution

`resolvedWeek(n) = applyOverrides(applyBlockRules(baseSessions, blockFor(n)), overridesFor(n))`

Deload rule: multiply sets by `setMultiplier`, round half up, minimum 1. Build rule: add `addSetsToTagged` sets to blocks with `progressVolume: true`.

---

## 5. Agent system

All agents are single Claude API calls with a dedicated system prompt and a required JSON output shape. The JavaScript orchestrator sequences them. **No agent writes to the plan directly.**

### 5.1 Flow: "Plan next week" button

```
1. Collect context: last 2 weeks of setLogs, bodyLog trend, notes, current block, next week's resolved plan
2. Weekly Review Agent   -> findings + suggested adjustments
3. Research Agent        -> (only if Review requests swaps/new ideas) candidates with citations
4. Program Designer      -> proposed weekOverride JSON
5. Validator (code)      -> pass / fail with reasons; on fail, one retry with reasons fed back
6. Diff screen           -> Thomas approves, edits, or rejects each change
7. Save                  -> new programVersion (undo available)
```

### 5.2 Agents

| Agent | Tools | Input | Output (JSON) | Guardrails |
|---|---|---|---|---|
| Weekly Review | none | logs, trend, notes, block | `{adherencePct, liftsProgressing[], liftsStalled[], painFlags[], deloadRecommended, suggestions[{type, target, reason}]}` | Must reference actual log data; no invented numbers |
| Research | web search (server tool), domain allowlist | a specific question from Review (e.g. "knee-friendly quad exercise alternatives to Bulgarian split squat") | `{candidates[{name, equipment, primary[], secondary[], setup, move, avoid, citations[{url, title}]}]}` | Summarize in own words; never copy program text verbatim; every candidate needs at least 1 citation URL returned by the tool |
| Program Designer | none | resolved week, review output, research candidates, guardrails, library | `{weekNumber, changes[{op, sessionId, exerciseId, fields}], rationale}` | Only uses exercise IDs in library or research candidates; respects 60-minute cap |
| Nutrition | none | bodyLog trend, phase target, age, current targets | `{kcalChange, proteinTargetG, reason}` | Changes limited to +/-150 kcal per 2 weeks |
| Coach Chat (optional) | web search | free text from Notes tab | answer + optional suggestion routed through Designer | Same validator path |

### 5.3 Validator (deterministic, unit tested)

Reads `guardrails` from the seed:
- Direct sets per muscle per week within 6-20
- Estimated session time (sets x (40s work + rest) + 10 min) at or under 60
- Squat and bench each at least 2x/week
- Load changes no greater than 10% week over week
- Compound RIR not below 1
- Every `exerciseId` exists in the library (or is a new, cited, approved candidate)
- JSON schema valid

These caps are programming judgment chosen to keep AI proposals conservative. They are not taken directly from a study.

### 5.4 API call template (VERIFY every detail against current docs before use)

```js
const res = await fetch("https://api.anthropic.com/v1/messages", {
  method: "POST",
  headers: {
    "x-api-key": settings.apiKey,
    "anthropic-version": "2023-06-01",
    "content-type": "application/json",
    "anthropic-dangerous-direct-browser-access": "true"
  },
  body: JSON.stringify({
    model: settings.model,                 // default "claude-sonnet-5"; verify string
    max_tokens: 4000,
    system: AGENT_SYSTEM_PROMPT,
    messages: [{ role: "user", content: contextJson }],
    tools: [{
      type: "web_search_20250305",         // basic version; newer versions exist, verify
      name: "web_search",
      max_uses: 5,
      allowed_domains: settings.allowedDomains
    }]
  })
});
```

Verification list for Claude Code (do not guess):
- Current model strings (as of 2026-09-11 these included `claude-opus-5`, `claude-sonnet-5`, `claude-haiku-4-5-20251001`)
- Web search tool version to use. Docs list `web_search_20250305` (basic), `web_search_20260209` (dynamic filtering), `web_search_20260318` (response inclusion control)
- Web search must be enabled for the organization in the Claude Console
- `allowed_domains` and `blocked_domains` cannot both be set
- Handling of `pause_turn` stop reason for long server-tool turns
- Whether a structured-output / JSON schema feature is available; otherwise prompt for JSON only and validate in code
- Per-search pricing and how to read usage from the response for the in-app cost meter

### 5.5 Suggested research domain allowlist (editable in Settings)

`pubmed.ncbi.nlm.nih.gov`, `pmc.ncbi.nlm.nih.gov`, `link.springer.com`, `bjsm.bmj.com`, `tandfonline.com`, `journals.lww.com`, `sportrxiv.org`, `jissn.biomedcentral.com`, `strongerbyscience.com`, `exrx.net`

Thomas should review this list. Claude Code should confirm each domain resolves before shipping it as a default.

---

## 6. The program

### 6.1 31-week map

| Weeks | Dates (Mon start) | Block | Sets | RIR | Nutrition |
|---|---|---|---|---|---|
| 1-4 | Sep 14 - Oct 11 | Base | As written | 2-3 | Lean gain |
| 5 | Oct 12 - 18 | Travel deload (Puerto Rico) | x0.5 | 4 | Maintenance |
| 6-10 | Oct 19 - Nov 22 | Build 1 | +1 on tagged | 1-2 | Lean gain |
| 11 | Nov 23 - 29 | Deload (Thanksgiving) | x0.5 | 4 | Lean gain |
| 12-15 | Nov 30 - Dec 27 | Build 2 | +1 on tagged, push loads | 1-2 | Lean gain |
| 16 | Dec 28 - Jan 3 | Deload | x0.5 | 4 | Lean gain |
| 17-21 | Jan 4 - Feb 7 | Build 3 | +1 on tagged, isolations to 0-1 RIR | 1-2 | Lean gain |
| 22 | Feb 8 - 14 | Deload + checkpoint | x0.5 | 4 | Maintenance |
| 23-28 | Feb 15 - Mar 28 | Refine | +1 on tagged | 1-2 | Maintenance or mild deficit |
| 29-30 | Mar 29 - Apr 11 | Taper | x0.7 | 2-3 | Maintenance, weight stable |
| 31 | Apr 12 - 17 | Wedding week | FBA Mon, FBB Wed at x0.5 | 3-4 | Maintenance |

Why Build 3 does not add more sets: with a 60-minute cap, every session with +1 set on tagged exercises already estimates 58-60 minutes. Later progression comes from load and effort, not more sets.

Suit fittings: Thomas should confirm the final fitting date with his tailor; weight should be stable from about Week 23 onward.

### 6.2 Weekly schedule (default, configurable)

| Mon | Tue | Wed | Thu | Fri | Sat | Sun |
|---|---|---|---|---|---|---|
| Full Body A | Cardio or basketball | Full Body B | Cardio or basketball | Full Body C | Cardio or basketball | Rest |

Rules: at least 1 day between lifting sessions. Warn if hard basketball is the day before Full Body A (heavy squat). Every session trains legs, so basketball after a session should be treated as a normal game, not a max-effort conditioning day.

### 6.3 Week 1 sessions (full detail in seed JSON)

Time estimates use sets x (40 s work + rest) + 10 min warm-up and transitions. Supersets count rest once per round.

**Full Body A: squat priority** (~57 min, ~58 with Build sets)

| Exercise | Sets x Reps | RIR | Rest |
|---|---|---|---|
| Barbell back squat | 4 x 8-10 | 2-3 | 3:00 |
| Barbell bench press | 3 x 8-10 | 2 | 2:30 |
| Lat pulldown (wide) | 3 x 8-12 | 2 | 1:30 |
| Seated leg curl | 3 x 10-12 | 1 | 1:30 |
| Cable lateral raise (tagged) | 3 x 12-15 | 1 | 1:00 |
| EZ-bar curl + cable pushdown (superset) | 2 x 10-12 each | 1 | 1:00 |

**Full Body B: hinge, upper chest, back, delts** (~57 min, ~60 with Build sets)

| Exercise | Sets x Reps | RIR | Rest |
|---|---|---|---|
| Barbell RDL | 3 x 8-10 | 2 | 2:30 |
| Incline DB press | 3 x 8-12 | 2 | 2:00 |
| Chest-supported DB row (tagged) | 3 x 10-12 | 2 | 1:30 |
| Leg press | 3 x 10-12 | 2 | 2:00 |
| DB lateral raise (tagged) + reverse cable fly (superset) | 3 + 2 x 12-15 | 1 | 1:00 |
| Standing calf raise | 3 x 10-15 | 1 | 1:00 |
| Cable crunch | 2 x 10-15 | 1 | 1:00 |

**Full Body C: bench priority** (~55 min, ~59 with Build sets)

| Exercise | Sets x Reps | RIR | Rest |
|---|---|---|---|
| Barbell bench press | 4 x 8-10 | 2 | 2:30 |
| Barbell back squat (lighter) | 3 x 8-10 | 3 | 3:00 |
| Lat pulldown (neutral, tagged) | 3 x 10-12 | 2 | 1:30 |
| Lying leg curl (tagged) | 3 x 10-12 | 1 | 1:30 |
| Incline DB curl + overhead cable extension (superset) | 2 x 10-12 each | 1 | 1:00 |
| Seated calf raise | 2 x 12-15 | 1 | 1:00 |

### 6.4 Base week direct sets per muscle (primary tags)

| Muscle | Sets | Muscle | Sets |
|---|---|---|---|
| Chest | 10 | Quads | 10 |
| Lats | 9 | Hamstrings | 9 |
| Upper back | 3 | Glutes | 10 (from squats/RDL) |
| Side delts | 6 | Calves | 5 |
| Rear delts | 2 | Abs | 2 |
| Biceps | 4 | Triceps | 4 |

Trade-off vs the earlier 4-day draft: roughly 10-25% fewer weekly sets for most muscles. Per Pelland et al., gains rise with volume but with diminishing returns, so this should cost some, not most, of the potential growth. Arms, rear delts, and abs also get indirect work from compounds (fractional sets). The app must compute this table live and show fractional totals (secondary muscles at 0.5 sets).

### 6.5 Progression

- **Load:** double progression. When every working set reaches the top of the rep range at the target RIR, add 5 lb next session; otherwise add reps.
- **Stall:** reps below the range for 2 straight sessions: drop 5-10% and rebuild.
- **Volume:** only via block rules or approved overrides.
- **Auto-deload signals** (Review Agent may recommend an early deload): reps dropping on 2+ priority lifts for 2 straight sessions, logged joint pain, a week of poor sleep or high stress.

---

## 7. Nutrition module

| Item | Target | Basis |
|---|---|---|
| Protein | 1.6-2.2 g/kg/day. At 165 lb (~74.8 kg): ~120-165 g. Default 145 g | Morton 2018 (plateau near 1.62 g/kg); upper bound is a commonly cited CI-based margin |
| Lean-gain rate | +0.25 to 0.5 lb/week (7-day average trend) | Helms 2023: faster gain mostly added fat. Rate itself is a practical target, not a study prescription |
| Surplus | Small, about 5-10% over maintenance | Helms 2023 tested 5% and 15% |
| Starting calories | Cannot be set yet: needs age. App estimates from inputs, then self-corrects from weigh-ins after 2-3 weeks | |
| Adjustment | Every 2 weeks: +/-100-150 kcal toward target trend | Practical convention, no verified source |
| Refine phase | Decide at Week 22 checkpoint: maintenance or mild deficit | |
| Creatine (optional) | 3-5 g/day monohydrate | ISSN position stand (Kreider 2017); check with a doctor if any medical concerns |

The app should log: morning weight, optional waist, protein grams, calories (optional). Chart 7-day average vs target band.

---

## 8. Research basis

| Topic | Finding | Source |
|---|---|---|
| Weekly volume | More weekly sets increased hypertrophy and strength, with diminishing returns (stronger diminishing returns for strength). 67 studies, 2,058 participants | Pelland JC et al. Sports Med (2025). https://pubmed.ncbi.nlm.nih.gov/41343037/ |
| Weekly volume | Each additional weekly set associated with ~0.37% greater muscle gain | Schoenfeld BJ et al. J Sports Sci (2017). https://pubmed.ncbi.nlm.nih.gov/27433992/ |
| Frequency | Frequency effect on hypertrophy compatible with negligible; strength increased with frequency (diminishing returns). Basis for 2x/week squat and bench | Pelland 2025 (above) |
| Proximity to failure | Hypertrophy increased as sets ended closer to failure; strength not clearly affected | Robinson ZP et al. Sports Med 54(9):2209-2231 (2024). https://pubmed.ncbi.nlm.nih.gov/38970765/ |
| Load / rep range | Hypertrophy similar across low and high loads when sets go to failure; 1RM strength favored heavier loads | Schoenfeld BJ et al. J Strength Cond Res 31(12):3508-3523 (2017). https://pubmed.ncbi.nlm.nih.gov/28834797/ |
| Protein | No further fat-free mass gains beyond ~1.62 g/kg/day total protein | Morton RW et al. Br J Sports Med 52:376-384 (2018). https://pubmed.ncbi.nlm.nih.gov/28698222/ |
| Energy surplus | 5% vs 15% surplus in trained lifters: faster body-mass gain mainly increased fat, not muscle or 1RM. Small sample (17 completers, 8 weeks) | Helms ER et al. Sports Med Open 9:102 (2023). https://doi.org/10.1186/s40798-023-00651-y |
| Creatine | Long-term supplementation reported safe in healthy people; ~3 g/day habitual intake discussed | Kreider RB et al. J Int Soc Sports Nutr 14:18 (2017). https://pubmed.ncbi.nlm.nih.gov/28615996/ |

Caveat: meta-analyses describe averages. Individual response varies, so the app's logs should drive adjustments.

---

## 9. Build plan with acceptance criteria

| Phase | Scope | Done when |
|---|---|---|
| 0. Audit | Diff live `index.html` vs Section 2; list features to preserve; ask Section 11 questions | Thomas approves the preserve list and answers |
| 1. Data layer | IndexedDB store, local date helper, lb units, stable IDs, migration from old `log_*`, `hist_*`, `forge_notes`, `sessions`, `streak` keys; JSON export/import | Migration test passes on a fixture of old keys; export then import round-trips exactly |
| 2. Program engine | Load `data/program.json`; resolve any week; week derived from start date; volume dashboard; manual week editor (swap, sets, reps, move day) with undo | Weeks 1, 5, 17, 29, 31 resolve correctly in tests; editor changes persist per week only |
| 3. Logging UX | Port existing logging, timers, summary; add RIR and pain flag per set; targets from progression | Full session loggable one-handed on iPhone; targets match double-progression tests |
| 4. Agents | Settings (key, model, allowlist, budget); api.js; 4 agents; validator; diff/approve; version history; cost meter | Validator unit tests pass; a failed validation never reaches the diff screen; nothing applies without a tap |
| 5. Nutrition + body | Weight/waist/protein log, trend chart, Nutrition Agent, wedding countdown | 7-day average and target band render; agent respects +/-150 kcal cap |
| 6. PWA polish | Manifest, service worker, offline logging, home-screen icon | Logging works in airplane mode; data persists after relaunch |

Tests: `node --test` with no dependencies for store migration, program resolution, progression, volume math, validator.

---

## 10. Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| API key exposed in browser | Key theft, unexpected charges | Key only in device storage, never in repo; set a spend limit in the Claude Console (verify feature); move to Option B later |
| Prompt injection from web pages | Agent proposes bad changes | Output limited to schema; deterministic validator; human approval; never execute returned code |
| Unsafe or unrealistic plans | Injury, burnout | Guardrail caps, RIR floor on compounds, scheduled deloads, pain flag triggers exercise swap |
| Data loss on iPhone | Lost history | IndexedDB, weekly export reminder, import tested |
| Provided file is stale | Regressions of live features | Phase 0 diff against live repo |
| Model/tool version drift | Broken agent calls | Model and tool versions in Settings/config; verify in docs |
| Cost creep | Surprise bills | `max_uses` on search, cache research results, cheaper model for parsing, in-app monthly budget stop |
| Basketball plus leg days | Fatigue, injury | Basketball day settings and 24-hour warning |
| Weight still changing near fittings | Suit alterations off | Maintenance from Week 23, stable weight from Week 29 |

---

## 11. Open questions to ask Thomas first

1. Is the live repo `index.html` newer than the file in the Claude project? Which live features must be kept?
2. Confirm Mon/Wed/Fri as default lifting days.
3. Which days does he usually play basketball?
4. Age (for the starting calorie estimate).
5. OK to switch from single-file edits in the GitHub web editor to multi-file commits pushed by Claude Code?
6. Does he already have an Anthropic API account with web search enabled?
7. Keep the old 52-week phase content anywhere, or replace fully with the 31-week block?

---

## 12. Style rules for UI copy

- Keep the current visual identity: dark theme, Bebas Neue headings, DM Sans body, lime `#c8f135` accent.
- No em dashes in UI text. Short, direct labels.
- All numbers in lb.
