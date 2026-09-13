import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import * as weeklyReview from '../js/agents/weekly-review.js';
import * as research from '../js/agents/research.js';
import * as programDesigner from '../js/agents/program-designer.js';
import * as nutrition from '../js/agents/nutrition.js';
import { extractJson } from '../js/util.js';

describe('weekly-review agent', () => {
  test('buildPrompt embeds the context data and asks for JSON only', () => {
    const prompt = weeklyReview.buildPrompt({
      blockName: 'Base', weekNumber: 3, totalWeeks: 31, priorityLifts: ['Barbell back squat', 'Barbell bench press'],
      recentSetLogs: [{ exerciseId: 'bb_back_squat', weightLb: 135, reps: 8 }],
      recentSessionHistory: [], recentNotes: [],
    });
    assert.match(prompt, /ONLY a JSON object/);
    assert.match(prompt, /"bb_back_squat"/);
    assert.match(prompt, /week 3 of 31/);
  });
});

describe('research agent', () => {
  test('buildPrompt embeds the question and suggested domains', () => {
    const prompt = research.buildPrompt({ question: 'Knee-friendly alternative to Bulgarian split squat?' });
    assert.match(prompt, /Knee-friendly alternative/);
    assert.match(prompt, /exrx\.net/);
    assert.match(prompt, /at least 1 citation/);
  });
});

describe('program-designer agent', () => {
  test('buildPrompt embeds the resolved week, library, and guardrails', () => {
    const prompt = programDesigner.buildPrompt({
      weekNumber: 5, blockName: 'Travel deload', guardrails: { maxSessionMinutes: 60 },
      resolvedWeek: { sessions: [] }, exerciseLibrarySummary: [{ id: 'bb_back_squat', name: 'Barbell back squat' }],
      reviewFindings: null, researchCandidates: null,
    });
    assert.match(prompt, /set_sets|set_reps|swap_exercise|move_day/);
    assert.match(prompt, /"bb_back_squat"/);
    assert.match(prompt, /None provided\./);
  });
});

describe('nutrition agent', () => {
  test('buildPrompt embeds athlete context and the kcal cap', () => {
    const prompt = nutrition.buildPrompt({
      nutritionPhase: 'lean_gain', proteinMin: 120, proteinMax: 165, currentProteinTarget: 145,
      heightIn: 72, startWeightLb: 165, age: 32, recentBodyLogs: [],
    });
    assert.match(prompt, /-150 and \+150/);
    assert.match(prompt, /lean_gain/);
  });
});

describe('extractJson (shared parser all agents\' pasted responses go through)', () => {
  test('parses a plain JSON object', () => {
    assert.deepEqual(extractJson('{"a":1}'), { a: 1 });
  });

  test('parses JSON wrapped in a ```json fence', () => {
    assert.deepEqual(extractJson('Here you go:\n```json\n{"a":1}\n```\nHope that helps!'), { a: 1 });
  });

  test('parses JSON wrapped in a plain ``` fence (no language tag)', () => {
    assert.deepEqual(extractJson('```\n{"a":1}\n```'), { a: 1 });
  });

  test('throws a friendly error on empty input', () => {
    assert.throws(() => extractJson(''), /Paste the response text first/);
  });

  test('throws a friendly error on invalid JSON', () => {
    assert.throws(() => extractJson('not json at all'), /doesn't look like valid JSON/);
  });
});
