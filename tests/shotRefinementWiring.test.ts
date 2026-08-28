import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

/**
 * That the prompt is composed in one place for all three callers.
 *
 * The rule is tested where it lives. What this pins is that nobody builds the
 * prompt themselves again — which is where this came from: the phone assembled
 * it inline in a screen, so a shot could not carry its own description and
 * nothing else could reuse or refine what was sent.
 */

const readRepo = (path: string) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

describe('the phone', () => {
  it('composes through the shared rule rather than gluing a template together', async () => {
    const plan = await readRepo('mobile/src/screens/PlanScreen.tsx');
    expect(plan).toContain('composeShotPrompt({');
    // The old inline template, which could not carry a per-shot description.
    expect(plan).not.toContain('— shot ${shot.index} of ${plan.shots.length}');
  });

  it('lets a shot carry its own description on top of the scenario', async () => {
    const plan = await readRepo('mobile/src/screens/PlanScreen.tsx');
    expect(plan).toContain('description: descriptions[shot.index]!.trim()');
  });

  it('regenerates one shot rather than the whole plan', async () => {
    const plan = await readRepo('mobile/src/screens/PlanScreen.tsx');
    expect(plan).toContain('const redoShot = async (index: number, changeNote: string)');
    expect(plan).toContain('refineShotPrompt(take.prompt, changeNote)');
    // Redoing a five-shot plan to fix the third one charged for the other four.
    expect(plan).not.toContain('void runGeneration()\n    // redo');
  });

  it('stands the new take where the old one was, and continues from the same frame', async () => {
    const plan = await readRepo('mobile/src/screens/PlanScreen.tsx');
    expect(plan).toContain('replaceTakeInTimeline(project, take.clipId, result.asset)');
    expect(plan).toContain('referenceImage: take.startFrame');

    const store = await readRepo('mobile/src/lib/projectStore.ts');
    // Through the shared rule, which refuses a take too short to cover the
    // shot rather than retiming the cut around it.
    expect(store).toContain('replaceClipSource(project.timeline');
  });
});

describe('the desktop', () => {
  it('refines a take with the same rule, keeping that take own settings', async () => {
    const studio = await readRepo('src/renderer/src/VideoGenerationWorkspace.tsx');
    expect(studio).toContain('refineShotPrompt(job.prompt, note)');
    // The previous take's length and shape, not whatever the composer is set
    // to now — otherwise one change quietly becomes several.
    expect(studio).toContain('aspectRatio: job.aspectRatio');
    expect(studio).toContain('durationSeconds: job.durationSeconds');
  });

  it('shows what was asked for and what was changed, separately', async () => {
    const studio = await readRepo('src/renderer/src/VideoGenerationWorkspace.tsx');
    expect(studio).toContain('originalOf(job.prompt)');
    expect(studio).toContain('revisionsOf(job.prompt)');
  });
});

describe('the agent', () => {
  it('has the composing rule as a tool, so its prompts match the surfaces', async () => {
    const server = await readRepo('src/main/openVideoMcpServer.ts');
    expect(server).toContain('composeShotPrompt(params: {');
    expect(server).toContain('refineShotPrompt(params.previousPrompt, params.change)');
  });
});
