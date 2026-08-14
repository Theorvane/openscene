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

  it('writes after the render rather than during it', async () => {
    // `persist` used to be called from inside the `setTimeline` updater, and
    // React runs an updater during render: the file write and the notification
    // that follows it updated the shell while another component was rendering,
    // and a double invocation would have written twice. Only running the app
    // surfaced it, as a warning rather than a failure.
    const editor = await read('src/lib/editorState.ts');
    expect(editor).not.toMatch(/setTimeline\(\(current\)[\s\S]*?persist\?\.\([\s\S]*?\}\);\n {4}\},/);
    expect(editor).toContain('pending.current = next;');
    expect(editor).toMatch(/useEffect\(\(\) => \{[\s\S]{0,200}persist\?\.\(next\);/);
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
    expect(app).toContain("useProject(route.name === 'project' ? route.projectId : null)");
    expect(app).toContain('pictureSeconds > 0');
  });

  it('calls the hook above the branch, not inside it', async () => {
    // Reading the project was a plain call, so it sat where it was needed —
    // after the branch that renders the project list. Subscribing made it a
    // hook, and a hook on only one of two routes changes the hook count between
    // renders: opening a project crashed outright with "rendered more hooks
    // than during the previous render". Typecheck and unit tests both passed;
    // only running the app found it.
    const app = await read('App.tsx');
    expect(app.indexOf('useProject('), 'the hook must precede the early return').toBeLessThan(
      app.indexOf("if (route.name === 'projects') {")
    );
    // And it has to accept the absence of a project, or the call above the
    // branch has nothing legitimate to pass.
    const hook = await read('src/lib/useProject.ts');
    expect(hook).toContain('id: string | null');
    expect(hook).toContain('if (id === null) return null;');
  });
});
