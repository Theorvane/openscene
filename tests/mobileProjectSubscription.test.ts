import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

/**
 * That a project change reaches the screen that did not make it.
 *
 * The tabs are siblings around one file: the editor imports, the Video and Image
 * tabs generate, and the shell above them decides whether Export has anything to
 * work on. Reading at render is only correct if something re-renders — and
 * nothing did, so importing a ten-second clip left Export disabled until the
 * user changed tabs and came back, which reads as a broken button.
 *
 * `projectStore` cannot be imported here: it opens `expo-file-system` at module
 * load. The wiring is asserted from source, the way the other mobile rules are.
 */

const read = (path: string) => readFile(new URL(`../mobile/${path}`, import.meta.url), 'utf8');

describe('project change notification', () => {
  it('announces from the one place that writes', async () => {
    const store = await read('src/lib/projectStore.ts');
    // Every mutation funnels through `writeProject`, so announcing there is what
    // makes "a caller forgot to notify" impossible rather than merely unlikely.
    expect(store).toMatch(/export function writeProject[\s\S]*?announce\(\);\n}/);
    // Deleting is the exception: it removes a directory instead of writing one.
    expect(store).toMatch(/export function deleteProject[\s\S]*?announce\(\);\n}/);
    expect(store).toContain('export function subscribeToProjects');
    expect(store).toContain('export function projectsEpoch');
  });

  it('gives React a snapshot it can compare', async () => {
    const hook = await read('src/lib/useProject.ts');
    expect(hook).toContain('useSyncExternalStore');
    // `readProject` builds a new object each call, and React compares snapshots
    // by identity — an unmemoised read is an infinite render loop that only ever
    // shows up at runtime.
    expect(hook).toContain('cached.epoch === projectsEpoch()');
  });

  it('has the shell subscribe rather than read once', async () => {
    const app = await read('App.tsx');
    expect(app).toContain('const project = useProject(route.projectId);');
    expect(app).toContain('pictureSeconds > 0');
  });
});
