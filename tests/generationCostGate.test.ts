import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { GENERATION_COST_POLICY } from '../src/main/agentChatGraph';
import { AGENT_CHAT_MUTATING_TOOL_NAMES, AGENT_CHAT_SPEND_TOOL_NAMES } from '../src/main/agentChatTools';

const graphSource = readFileSync(resolve(process.cwd(), 'src/main/agentChatGraph.ts'), 'utf8');
const skillDoc = readFileSync(
  resolve(process.cwd(), '.agents/skills/generation-cost-approval/SKILL.md'),
  'utf8'
);

describe('spend tools', () => {
  it('treats every generation tool as both mutating and spending', () => {
    // Given / When / Then
    for (const tool of ['createVideoJob', 'createSpeechJob', 'createImageJob']) {
      expect(AGENT_CHAT_SPEND_TOOL_NAMES.has(tool), `${tool} should spend`).toBe(true);
      // A spend tool outside the mutating set would never reach the approval
      // gate at all, which is worse than being auto-approved inside it.
      expect(AGENT_CHAT_MUTATING_TOOL_NAMES.has(tool), `${tool} should need approval`).toBe(true);
    }
  });

  it('does not treat timeline edits or exports as spending', () => {
    // Given / When / Then
    // Over-listing here would make ordinary editing re-prompt forever and train
    // the user to click through the prompt that actually guards money.
    for (const tool of ['trimTimelineClip', 'addClipToTimeline', 'removeTimelineClip', 'exportProjectVideo']) {
      expect(AGENT_CHAT_SPEND_TOOL_NAMES.has(tool), `${tool} should not spend`).toBe(false);
    }
  });

  it('never lets an always-allow answer cover a later charge', () => {
    // The graph has two places where "always" could leak into a spend tool: the
    // shortcut that skips the prompt, and the list that persists the answer.
    expect(graphSource).toContain('const spends = options.spendToolNames?.has(call.name) ?? false;');
    expect(graphSource).toContain('if (!spends && state.alwaysAllowedTools.includes(call.name)) {');
    expect(graphSource).toContain('.filter((name) => !(options.spendToolNames?.has(name) ?? false));');
  });
});

describe('generation cost policy', () => {
  it('orders the steps so nothing is generated before a price is approved', () => {
    // Given
    const policy = GENERATION_COST_POLICY;

    // When
    const askLength = policy.indexOf('Ask target length');
    const scenario = policy.indexOf('planVideoScenario');
    const price = policy.indexOf('estimateGenerationCost');
    const approve = policy.indexOf('Wait for user approval');
    const generate = policy.indexOf('Generate shot by shot');

    // Then
    expect(askLength).toBeGreaterThan(-1);
    expect(scenario).toBeGreaterThan(askLength);
    expect(price).toBeGreaterThan(scenario);
    expect(approve).toBeGreaterThan(price);
    expect(generate).toBeGreaterThan(approve);
  });

  it('forbids the model quoting a price from its own memory', () => {
    // The whole point of the tool is that a recalled price is a fabrication
    // with a currency symbol in front of it.
    expect(GENERATION_COST_POLICY).toMatch(/[Nn]ever state price from own knowledge/);
    expect(GENERATION_COST_POLICY).toMatch(/are not real prices/);
  });

  it('requires the unpriced case to become a question rather than a number', () => {
    expect(GENERATION_COST_POLICY).toMatch(/unpriced/);
    expect(GENERATION_COST_POLICY).toMatch(/accept unknown charge/);
  });

  it('keeps plan approval and per-call approval as two separate things', () => {
    // Approving a shot list is not consent for each tool call, and the tool
    // gate does not tell the user what the plan costs.
    expect(GENERATION_COST_POLICY).toMatch(/both required/);
  });

  it('lets the user opt out, but only out loud', () => {
    expect(GENERATION_COST_POLICY).toMatch(/says skip estimate/);
    expect(GENERATION_COST_POLICY).toMatch(/say plainly/);
  });

  it('exempts the spend confirmation from the terse style the rest of the prompt uses', () => {
    // caveman's own Auto-Clarity rule: do not compress irreversible-action
    // confirmations. A misread charge is the exact failure that costs money.
    expect(GENERATION_COST_POLICY).toMatch(/full clear prose, not compressed/);
    expect(GENERATION_COST_POLICY).toMatch(/must not misread/);
  });

  it('reaches the model instead of only existing as a constant', () => {
    expect(graphSource).toContain('GENERATION_COST_POLICY;');
  });
});

describe('skill document', () => {
  it('documents the same procedure the agent actually runs', () => {
    // A skill file describing a different flow from the shipped prompt is worse
    // than none: it reads as the spec while the code does something else.
    for (const step of ['estimateGenerationCost', 'planVideoScenario', 'unpriced', 'always']) {
      expect(skillDoc, `skill doc should cover ${step}`).toContain(step);
    }
  });

  it('says where enforcement lives, so it is not mistaken for the mechanism', () => {
    expect(skillDoc).toContain('src/main/agentChatGraph.ts');
    expect(skillDoc).toContain('src/shared/mediaGenerationPricing.ts');
  });
});
