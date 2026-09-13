// js/agent-screen.js
// Phase 4: the "Ask Claude" section on the Plan screen. No API calls, no
// stored key -- this assembles a prompt to copy into a Claude conversation
// (this app, Claude Code, claude.ai, whatever you have open), and a place
// to paste the JSON response back. Every response is run through
// js/validator.js before anything is shown as a diff, and nothing is
// written to the plan until you tap Approve. Program Designer proposals
// and manual edits from the Plan screen's editor are stored identically
// (js/store.js's weekOverrides), so they share the exact same undo history.

import { Store, localDateStr } from './store.js';
import { resolveWeek, weekNumberForDate } from './program.js';
import { extractJson, escapeHtml } from './util.js';
import {
  validateProgramDesignerOutput,
  validateNutritionOutput,
  validateWeeklyReviewOutput,
  validateResearchOutput,
} from './validator.js';
import * as weeklyReviewAgent from './agents/weekly-review.js';
import * as researchAgent from './agents/research.js';
import * as programDesignerAgent from './agents/program-designer.js';
import * as nutritionAgent from './agents/nutrition.js';

const AGENTS = [weeklyReviewAgent, researchAgent, programDesignerAgent, nutritionAgent];
const RECENT_LOG_LIMIT = 60; // most recent N set logs across all exercises, plenty for a 2-3 week window
const RECENT_SESSION_LIMIT = 10;
const RECENT_NOTES_LIMIT = 15;

function copyToClipboard(text) {
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text).then(() => true, () => false);
  }
  return Promise.resolve(false);
}

class AgentScreen {
  constructor() {
    this.program = null;
    this.store = null;
    this.targetWeek = 1;
    this.lastReview = null;     // in-memory only -- feeds Program Designer's context if run this session
    this.lastResearch = null;
    this.researchQuestion = '';
  }

  async init() {
    try {
      const res = await fetch('data/program.json');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      this.program = await res.json();
    } catch (err) {
      console.error('Forge: agent screen could not load data/program.json', err);
      return;
    }
    try {
      this.store = new Store();
      await this.store.open();
    } catch (err) {
      console.warn('Forge: IndexedDB unavailable, agent proposals cannot be applied this session.', err);
      this.store = null;
    }
    const currentWeek = weekNumberForDate(this.program, new Date());
    this.targetWeek = Math.min(this.program.meta.totalWeeks, currentWeek + 1);

    this._renderShell();
    this._wireStatic();
    await this._renderAgentCards();
  }

  _renderShell() {
    const el = document.getElementById('agentTargetWeek');
    if (el) el.value = this.targetWeek;
    const total = document.getElementById('agentTotalWeeks');
    if (total) total.textContent = this.program.meta.totalWeeks;
  }

  _wireStatic() {
    document.getElementById('agentTargetWeek')?.addEventListener('change', e => {
      const n = parseInt(e.target.value, 10);
      if (n >= 1 && n <= this.program.meta.totalWeeks) this.targetWeek = n;
      else e.target.value = this.targetWeek;
    });
    document.getElementById('agentResearchQuestion')?.addEventListener('input', e => {
      this.researchQuestion = e.target.value;
    });
    document.getElementById('agentValidateBtn')?.addEventListener('click', () => this._validateAndPreview());
  }

  async _renderAgentCards() {
    const container = document.getElementById('agentCards');
    if (!container) return;
    container.innerHTML = AGENTS.map(agent => `
      <div class="lift-history-card">
        <div class="lift-history-name">${escapeHtml(agent.label)}</div>
        <div class="drawer-ex-tip" style="margin-bottom:10px">${escapeHtml(agent.description)}</div>
        ${agent.id === 'research' ? `
          <textarea class="notes-textarea" id="agentResearchQuestion" placeholder="e.g. Knee-friendly alternative to Bulgarian split squat?" style="margin-bottom:8px;min-height:50px"></textarea>
        ` : ''}
        <button class="notes-copy-btn" style="margin-top:0" data-copy-agent="${agent.id}">Copy prompt for Claude</button>
        <div class="notes-saved-flash" id="agentFlash-${agent.id}" style="opacity:0"></div>
      </div>
    `).join('');
    container.querySelectorAll('[data-copy-agent]').forEach(btn => {
      btn.addEventListener('click', () => this._copyPrompt(btn.dataset.copyAgent));
    });
    document.getElementById('agentResearchQuestion')?.addEventListener('input', e => {
      this.researchQuestion = e.target.value;
    });
  }

  async _gatherCommonData() {
    const [setLogs, sessionHistory, notes] = this.store
      ? await Promise.all([this.store.getAll('setLogs'), this.store.getAll('sessionHistory'), this.store.getAll('notes')])
      : [[], [], []];
    setLogs.sort((a, b) => a.date.localeCompare(b.date));
    sessionHistory.sort((a, b) => b.date.localeCompare(a.date));
    notes.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    return {
      recentSetLogs: setLogs.slice(-RECENT_LOG_LIMIT),
      recentSessionHistory: sessionHistory.slice(0, RECENT_SESSION_LIMIT),
      recentNotes: notes.slice(0, RECENT_NOTES_LIMIT),
    };
  }

  async _buildContext(agentId) {
    const overrides = this.store ? await this.store.getOverridesForWeek(this.targetWeek) : [];
    const resolvedWeek = resolveWeek(this.program, this.targetWeek, overrides);
    const priorityLifts = (this.program.meta.priorityLifts || [])
      .map(id => this.program.exerciseLibrary.find(e => e.id === id)?.name || id);

    if (agentId === 'weekly-review') {
      const common = await this._gatherCommonData();
      return { blockName: resolvedWeek.block.name, weekNumber: this.targetWeek, totalWeeks: this.program.meta.totalWeeks, priorityLifts, ...common };
    }
    if (agentId === 'research') {
      return { question: this.researchQuestion.trim() || '(no question entered -- describe what you want researched before copying this prompt)' };
    }
    if (agentId === 'program-designer') {
      const exerciseLibrarySummary = this.program.exerciseLibrary.map(e => ({
        id: e.id, name: e.name, equipment: e.equipment, pattern: e.pattern, primary: e.primary, secondary: e.secondary,
      }));
      return {
        weekNumber: this.targetWeek,
        blockName: resolvedWeek.block.name,
        guardrails: this.program.guardrails,
        resolvedWeek,
        exerciseLibrarySummary,
        reviewFindings: this.lastReview,
        researchCandidates: this.lastResearch,
      };
    }
    if (agentId === 'nutrition') {
      const meta = this.store ? await this.store.getMeta() : {};
      const bodyLogs = this.store ? await this.store.getAll('bodyLogs') : [];
      bodyLogs.sort((a, b) => a.date.localeCompare(b.date));
      const range = this.program.nutrition.proteinTargetGPerDay;
      return {
        nutritionPhase: resolvedWeek.block.nutritionPhase,
        proteinMin: range.min,
        proteinMax: range.max,
        currentProteinTarget: meta.nutritionTarget?.proteinTargetG ?? range.default,
        currentKcalTarget: meta.nutritionTarget?.kcalTarget ?? null,
        heightIn: this.program.meta.athlete.heightIn,
        startWeightLb: this.program.meta.athlete.startWeightLb,
        age: this.program.meta.athlete.age,
        recentBodyLogs: bodyLogs.slice(-14),
      };
    }
    throw new Error(`Unknown agent: ${agentId}`);
  }

  async _copyPrompt(agentId) {
    const agent = AGENTS.find(a => a.id === agentId);
    const ctx = await this._buildContext(agentId);
    const prompt = agent.buildPrompt(ctx);
    const ok = await copyToClipboard(prompt);
    const flash = document.getElementById(`agentFlash-${agentId}`);
    if (ok) {
      if (flash) { flash.textContent = 'Copied. Paste it into your Claude conversation.'; flash.style.opacity = '1'; setTimeout(() => flash.style.opacity = '0', 2500); }
    } else {
      // Clipboard API unavailable (e.g. non-HTTPS context) -- fall back to a visible, selectable textarea.
      const holder = document.getElementById('agentFallbackHolder');
      if (holder) {
        holder.innerHTML = `<div class="section-label">Copy failed -- select and copy manually</div><textarea class="notes-textarea" style="min-height:160px" readonly>${escapeHtml(prompt)}</textarea>`;
        holder.querySelector('textarea').select();
      }
    }
  }

  async _validateAndPreview() {
    const textEl = document.getElementById('agentPasteInput');
    const resultEl = document.getElementById('agentResult');
    let json;
    try {
      json = extractJson(textEl.value);
    } catch (err) {
      resultEl.innerHTML = this._renderErrors([err.message]);
      return;
    }

    const kind = this._detectKind(json);
    if (kind === 'program-designer') {
      const overrides = this.store ? await this.store.getOverridesForWeek(json.weekNumber) : [];
      const result = validateProgramDesignerOutput(this.program, overrides, json);
      if (!result.valid) { this._showErrors(result.errors, json); return; }
      await this._renderProgramDesignerDiff(json, overrides);
    } else if (kind === 'nutrition') {
      const meta = this.store ? await this.store.getMeta() : {};
      const hasExistingBaseline = meta.nutritionTarget?.kcalTarget != null;
      const result = validateNutritionOutput(this.program, json, hasExistingBaseline);
      if (!result.valid) { this._showErrors(result.errors, json); return; }
      await this._renderNutritionDiff(json);
    } else if (kind === 'weekly-review') {
      const result = validateWeeklyReviewOutput(json);
      if (!result.valid) { this._showErrors(result.errors, json); return; }
      this.lastReview = json;
      resultEl.innerHTML = this._renderReviewSummary(json);
    } else if (kind === 'research') {
      const result = validateResearchOutput(json);
      if (!result.valid) { this._showErrors(result.errors, json); return; }
      this.lastResearch = json;
      resultEl.innerHTML = this._renderResearchSummary(json);
    } else {
      this._showErrors(['Could not tell which agent this response is from. Expected one of: weekNumber+changes (Program Designer), candidates (Research), kcalChange (Nutrition), adherencePct (Weekly Review).']);
    }
  }

  _detectKind(json) {
    if (!json || typeof json !== 'object') return null;
    if ('changes' in json && 'weekNumber' in json) return 'program-designer';
    if ('candidates' in json) return 'research';
    if ('kcalChange' in json) return 'nutrition';
    if ('adherencePct' in json) return 'weekly-review';
    return null;
  }

  /** Renders the failed-validation card and wires its retry-copy button (if any) in one place. */
  _showErrors(errors, json) {
    const resultEl = document.getElementById('agentResult');
    const retryText = json
      ? `The JSON you returned failed validation for this reason(s):\n${errors.map(e => `- ${e}`).join('\n')}\n\nHere is what you returned:\n${JSON.stringify(json, null, 2)}\n\nPlease revise and return corrected JSON in the same shape as before.`
      : null;
    resultEl.innerHTML = `<div class="lift-history-card" style="border-left:3px solid var(--danger)">
      <div class="lift-history-name" style="color:var(--danger)">Failed validation</div>
      ${errors.map(e => `<div class="drawer-ex-tip">${escapeHtml(e)}</div>`).join('')}
      ${retryText ? `<button class="notes-copy-btn" id="agentCopyRetry">Copy error report to send back to Claude</button>` : ''}
    </div>`;
    if (retryText) document.getElementById('agentCopyRetry').addEventListener('click', () => copyToClipboard(retryText));
  }

  async _renderProgramDesignerDiff(proposal, overrides) {
    const resultEl = document.getElementById('agentResult');
    const before = resolveWeek(this.program, proposal.weekNumber, overrides);
    const after = resolveWeek(this.program, proposal.weekNumber, [...overrides, { weekNumber: proposal.weekNumber, changes: proposal.changes }]);
    const exerciseById = new Map(this.program.exerciseLibrary.map(e => [e.id, e]));

    const rows = proposal.changes.map(c => {
      const beforeSession = before.sessions.find(s => s.id === c.sessionId);
      const afterSession = after.sessions.find(s => s.id === c.sessionId);
      const beforeBlock = beforeSession?.blocks.find(b => b.exerciseId === c.exerciseId);
      let label, beforeVal, afterVal;
      if (c.op === 'set_sets') {
        label = exerciseById.get(c.exerciseId)?.name || c.exerciseId;
        beforeVal = `${beforeBlock?.sets} sets`; afterVal = `${c.fields.sets} sets`;
      } else if (c.op === 'set_reps') {
        label = exerciseById.get(c.exerciseId)?.name || c.exerciseId;
        beforeVal = `${beforeBlock?.repMin}-${beforeBlock?.repMax} reps`; afterVal = `${c.fields.repMin}-${c.fields.repMax} reps`;
      } else if (c.op === 'swap_exercise') {
        label = `${c.sessionId} exercise swap`;
        beforeVal = exerciseById.get(c.exerciseId)?.name || c.exerciseId;
        afterVal = exerciseById.get(c.fields.newExerciseId)?.name || c.fields.newExerciseId;
      } else if (c.op === 'move_day') {
        label = 'Schedule';
        beforeVal = 'current day mapping';
        afterVal = `${c.fields.day} -> ${c.fields.sessionId}`;
      }
      return `<div class="drawer-ex">
        <div class="drawer-ex-top">
          <div class="drawer-ex-name">${escapeHtml(label)}</div>
        </div>
        <div class="drawer-ex-tip">${escapeHtml(beforeVal)} <strong style="color:var(--accent)">&rarr; ${escapeHtml(afterVal)}</strong></div>
      </div>`;
    }).join('');

    resultEl.innerHTML = `<div class="lift-history-card">
      <div class="lift-history-name">Proposed changes for week ${proposal.weekNumber} (${after.block.name})</div>
      <div class="drawer-ex-tip" style="margin-bottom:10px">${escapeHtml(proposal.rationale)}</div>
      ${rows}
      <div style="display:flex;gap:8px;margin-top:12px">
        <button class="notes-save-btn" id="agentApproveBtn" style="flex:1">Approve and apply</button>
        <button class="notes-copy-btn" id="agentRejectBtn" style="flex:1;margin-top:0">Reject</button>
      </div>
    </div>`;
    document.getElementById('agentApproveBtn').addEventListener('click', async () => {
      if (!this.store) { alert('Changes cannot be saved right now (storage unavailable).'); return; }
      await this.store.addOverride({
        weekNumber: proposal.weekNumber,
        changes: proposal.changes,
        createdBy: 'agent',
        approvedAt: new Date().toISOString(),
        rationale: proposal.rationale,
      });
      resultEl.innerHTML = `<div class="lift-history-card"><div class="lift-history-name" style="color:var(--accent)">Applied to week ${proposal.weekNumber}.</div><div class="drawer-ex-tip">Open the Plan tab to see it, or undo it from there like any other change.</div></div>`;
      document.getElementById('agentPasteInput').value = '';
    });
    document.getElementById('agentRejectBtn').addEventListener('click', () => {
      resultEl.innerHTML = '';
      document.getElementById('agentPasteInput').value = '';
    });
  }

  async _renderNutritionDiff(proposal) {
    const resultEl = document.getElementById('agentResult');
    const meta = this.store ? await this.store.getMeta() : {};
    const range = this.program.nutrition.proteinTargetGPerDay;
    const currentProtein = meta.nutritionTarget?.proteinTargetG ?? range.default;
    // kcalChange is always relative to whatever baseline is already set (Section
    // 7: adjustments are +/-100-150 kcal every 2 weeks against an existing
    // target). If no baseline exists yet, this establishes one starting from 0
    // plus the change -- Phase 5's Progress screen also offers a plain manual
    // number entry for setting a starting baseline directly, without going
    // through the agent/validator path (establishing a number isn't a "change"
    // that needs a cap).
    const currentKcal = meta.nutritionTarget?.kcalTarget ?? null;
    const newKcal = (currentKcal ?? 0) + proposal.kcalChange;
    resultEl.innerHTML = `<div class="lift-history-card">
      <div class="lift-history-name">Proposed nutrition adjustment</div>
      <div class="drawer-ex-tip" style="margin-bottom:10px">${escapeHtml(proposal.reason)}</div>
      <div class="drawer-ex">
        <div class="drawer-ex-top"><div class="drawer-ex-name">Daily calories</div></div>
        <div class="drawer-ex-tip">${currentKcal != null ? `${currentKcal} kcal` : 'no baseline set'} <strong style="color:var(--accent)">&rarr; ${newKcal} kcal</strong> (${proposal.kcalChange >= 0 ? '+' : ''}${proposal.kcalChange})</div>
      </div>
      <div class="drawer-ex">
        <div class="drawer-ex-top"><div class="drawer-ex-name">Protein target</div></div>
        <div class="drawer-ex-tip">${currentProtein}g <strong style="color:var(--accent)">&rarr; ${proposal.proteinTargetG}g</strong></div>
      </div>
      <div style="display:flex;gap:8px;margin-top:12px">
        <button class="notes-save-btn" id="agentApproveNutritionBtn" style="flex:1">Approve and apply</button>
        <button class="notes-copy-btn" id="agentRejectBtn" style="flex:1;margin-top:0">Reject</button>
      </div>
    </div>`;
    document.getElementById('agentApproveNutritionBtn').addEventListener('click', async () => {
      if (!this.store) { alert('Changes cannot be saved right now (storage unavailable).'); return; }
      await this.store.putMeta({
        nutritionTarget: {
          kcalTarget: newKcal,
          proteinTargetG: proposal.proteinTargetG,
          lastAdjustment: { kcalChange: proposal.kcalChange, reason: proposal.reason, appliedAt: new Date().toISOString() },
        },
      });
      resultEl.innerHTML = `<div class="lift-history-card"><div class="lift-history-name" style="color:var(--accent)">Nutrition target updated.</div></div>`;
      document.getElementById('agentPasteInput').value = '';
    });
    document.getElementById('agentRejectBtn').addEventListener('click', () => {
      resultEl.innerHTML = '';
      document.getElementById('agentPasteInput').value = '';
    });
  }

  _renderReviewSummary(json) {
    const listOrNone = arr => arr.length ? arr.map(escapeHtml).join(', ') : 'none';
    return `<div class="lift-history-card">
      <div class="lift-history-name">Weekly Review</div>
      <div class="drawer-ex-tip">Adherence: ${json.adherencePct}%</div>
      <div class="drawer-ex-tip">Progressing: ${listOrNone(json.liftsProgressing)}</div>
      <div class="drawer-ex-tip">Stalled: ${listOrNone(json.liftsStalled)}</div>
      <div class="drawer-ex-tip">Pain flags: ${listOrNone(json.painFlags)}</div>
      <div class="drawer-ex-tip">Deload recommended: ${json.deloadRecommended ? 'yes' : 'no'}</div>
      ${json.suggestions.map(s => `<div class="drawer-ex"><div class="drawer-ex-top"><div class="drawer-ex-name">${escapeHtml(s.type)}: ${escapeHtml(s.target)}</div></div><div class="drawer-ex-tip">${escapeHtml(s.reason)}</div></div>`).join('')}
      <div class="drawer-ex-tip" style="margin-top:8px;color:var(--phase2)">Saved for this session -- Design next week will use these findings automatically.</div>
    </div>`;
  }

  _renderResearchSummary(json) {
    return `<div class="lift-history-card">
      <div class="lift-history-name">Research candidates</div>
      ${json.candidates.map(c => `<div class="drawer-ex">
        <div class="drawer-ex-top"><div class="drawer-ex-name">${escapeHtml(c.name)}</div></div>
        <div class="drawer-ex-tip">${escapeHtml(c.setup || '')}</div>
        <div class="drawer-ex-tip">${(c.citations || []).map(cit => `<a href="${escapeHtml(cit.url)}" target="_blank" rel="noopener">${escapeHtml(cit.title || cit.url)}</a>`).join(', ')}</div>
      </div>`).join('')}
      <div class="drawer-ex-tip" style="margin-top:8px;color:var(--phase2)">Saved for this session -- Design next week will use these candidates automatically.</div>
    </div>`;
  }
}

const app = new AgentScreen();
app.init();
