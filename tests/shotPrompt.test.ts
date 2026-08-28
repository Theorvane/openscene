import { describe, expect, it } from 'vitest';

import {
  composeShotPrompt,
  MAX_SHOT_PROMPT_CHARS,
  originalOf,
  refineShotPrompt,
  revisionsOf,
  takeLabel
} from '../src/shared/shotPrompt';

/**
 * What is actually sent to a video model, and what happens to it when someone
 * says what they wanted instead.
 *
 * The refinement is arithmetic rather than a model on purpose: a rewrite loses
 * the parts nobody mentioned, which are the parts continuity is made of. These
 * pin that the previous prompt survives whole.
 */

describe('the prompt for one shot', () => {
  it('carries the scenario, where the shot sits, and how long it runs', () => {
    const prompt = composeShotPrompt({
      scenario: 'A courier cycles through a wet city at night',
      index: 2,
      count: 5,
      durationSeconds: 8,
      continuity: 'restate'
    });
    expect(prompt).toContain('A courier cycles through a wet city at night');
    expect(prompt).toContain('Shot 2 of 5, 8s.');
    // With no frame to hand over, what must stay the same is spelled out.
    expect(prompt).toContain('Keep consistent: subject, wardrobe');
  });

  it('leads with the shot own description and keeps the scenario as context', () => {
    const prompt = composeShotPrompt({
      scenario: 'A courier cycles through a wet city at night',
      description: 'Close on the front wheel throwing spray',
      index: 3,
      count: 5,
      durationSeconds: 4,
      continuity: 'from-frame'
    });
    expect(prompt.startsWith('Close on the front wheel throwing spray')).toBe(true);
    expect(prompt).toContain('Scenario: A courier cycles through a wet city at night');
    // Looking at the last frame, it is asked to carry on rather than to be
    // told what it can already see.
    expect(prompt).toContain('Continue directly from the supplied first frame');
  });

  it('says nothing about shot numbers or continuity for a single shot', () => {
    const prompt = composeShotPrompt({
      scenario: 'A courier cycles through a wet city at night',
      index: 1,
      count: 1,
      durationSeconds: 5,
      continuity: 'none'
    });
    expect(prompt).toBe('A courier cycles through a wet city at night 5s.');
  });
});

describe('refining a take', () => {
  const first = composeShotPrompt({
    scenario: 'A courier cycles through a wet city at night',
    index: 1,
    count: 1,
    durationSeconds: 5,
    continuity: 'none'
  });

  it('keeps the previous prompt whole and adds the change to it', () => {
    const refined = refineShotPrompt(first, 'Slower camera move');
    expect(refined.ok).toBe(true);
    if (!refined.ok) return;
    expect(originalOf(refined.prompt)).toBe(first);
    expect(revisionsOf(refined.prompt)).toEqual(['Slower camera move']);
  });

  it('accumulates notes in the order they were asked for', () => {
    const once = refineShotPrompt(first, 'Slower camera move');
    if (!once.ok) return;
    const twice = refineShotPrompt(once.prompt, 'No text on screen');
    expect(twice.ok).toBe(true);
    if (!twice.ok) return;
    expect(revisionsOf(twice.prompt)).toEqual(['Slower camera move', 'No text on screen']);
    // The original is still the original after two rounds, not a paraphrase
    // of itself.
    expect(originalOf(twice.prompt)).toBe(first);
  });

  it('does not ask twice for the same change', () => {
    const once = refineShotPrompt(first, 'Slower camera move');
    if (!once.ok) return;
    const again = refineShotPrompt(once.prompt, 'slower camera MOVE');
    expect(again).toEqual({ ok: true, prompt: once.prompt });
  });

  it('asks for a note rather than running the same take again', () => {
    expect(refineShotPrompt(first, '   ')).toEqual({ ok: false, reason: 'Say what to change about this shot.' });
  });

  it('refuses once the prompt would be longer than this app will send', () => {
    const long = 'x'.repeat(MAX_SHOT_PROMPT_CHARS - 50);
    const refused = refineShotPrompt(long, 'Something that no longer fits inside the bound');
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    // Truncation would cut the end, which is where the newest change lives —
    // the one the user just asked for.
    expect(refused.reason).toContain('past the 2000 this app will send');
  });

  it('reads back nothing from a prompt that was never refined', () => {
    expect(revisionsOf(first)).toEqual([]);
    expect(originalOf(first)).toBe(first);
  });
});

describe('naming takes', () => {
  it('counts from one', () => {
    expect(takeLabel(1)).toBe('Take 1');
    expect(takeLabel(0)).toBe('Take 1');
    expect(takeLabel(3)).toBe('Take 3');
  });
});
