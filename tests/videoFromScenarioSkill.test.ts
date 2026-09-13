import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { CONTINUITY_KEYS } from '../src/shared/videoStoryboardPlan';

const skill = readFileSync(resolve(process.cwd(), '.agents/skills/video-from-scenario/SKILL.md'), 'utf8');
const mcpSource = readFileSync(resolve(process.cwd(), 'src/main/openVideoMcpServer.ts'), 'utf8');

/** Tool names the skill front matter claims it is allowed to use. */
function allowedTools(): readonly string[] {
  const match = skill.match(/^allowed-tools:\s*(.+)$/m);
  return (match?.[1] ?? '').split(',').map((name) => name.trim()).filter((name) => name.length > 0);
}

describe('video-from-scenario skill', () => {
  it('only claims tools the MCP server actually defines', () => {
    // Given
    const tools = allowedTools();

    // Then
    expect(tools.length).toBeGreaterThan(0);
    for (const tool of tools) {
      // A skill naming a tool that does not exist sends the agent looking for
      // it mid-task; the failure then looks like a model problem.
      expect(mcpSource, `${tool} is not defined on the MCP server`).toMatch(
        new RegExp(`\\b(async )?${tool}\\(params`)
      );
    }
  });

  it('documents every continuity field the planner returns', () => {
    // Given / When / Then
    // The plan hands these keys to the agent; a field listed in code but not in
    // the skill is one nothing tells the agent to repeat.
    for (const key of CONTINUITY_KEYS) {
      expect(skill, `continuity field ${key} is undocumented`).toContain(`\`${key}\``);
    }
  });

  it('orders stills before clips, which is the whole reason for the pipeline', () => {
    // Given / When
    const stills = skill.indexOf('## Step 5 — Stills');
    const clips = skill.indexOf('## Step 6 — Clips');
    const approve = skill.indexOf('## Step 4 — Price and approve');

    // Then
    expect(approve).toBeGreaterThan(-1);
    expect(stills).toBeGreaterThan(approve);
    expect(clips).toBeGreaterThan(stills);
  });

  it('tells the agent not to do the shot arithmetic itself', () => {
    expect(skill).toMatch(/Do not do this arithmetic yourself/);
    expect(skill).toContain('roundedFrom');
  });

  it('requires continuity to be repeated verbatim rather than referenced', () => {
    // "the same woman as before" is the single most common continuity failure.
    expect(skill).toMatch(/Repeat the description verbatim/);
    expect(skill).toMatch(/there is no before/);
  });

  it('names the mid-plan failure case instead of leaving it to improvisation', () => {
    expect(skill).toMatch(/A failed shot mid-plan/);
    expect(skill).toMatch(/do not silently skip it/);
  });

  it('keeps the heavy prompt guidance in references rather than the skill body', () => {
    // Progressive disclosure: turns that do not write prompts should not pay
    // for the recipe tables.
    expect(skill).toContain('references/prompt-recipes.md');
    const recipes = readFileSync(
      resolve(process.cwd(), '.agents/skills/video-from-scenario/references/prompt-recipes.md'),
      'utf8'
    );
    expect(recipes.length).toBeGreaterThan(400);
    expect(skill).not.toContain('rack focus');
  });
});

describe('image-to-video link', () => {
  it('lets a generated still seed a clip through a job id, not a path', () => {
    // Given / When / Then
    expect(mcpSource).toContain('referenceImageJobId');
    // Resolving the id to inline bytes in main keeps filesystem paths out of
    // both the agent's context and the renderer.
    expect(mcpSource).toContain('getGeneratedImageAsReference(firstFrameJobId)');
    expect(mcpSource).toContain('lastFrameImageJobId');
    expect(mcpSource).toContain('referenceImageJobIds');
  });

  it('fails loudly when the referenced image job has no completed image', () => {
    expect(mcpSource).toMatch(/has no completed image to use as a first frame/);
  });
});
