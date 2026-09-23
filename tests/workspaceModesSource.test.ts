import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = (path: string): string => readFileSync(new URL('../' + path, import.meta.url), 'utf8');

describe('workspace integration contracts', () => {
  it('uses the shared mode contract on both surfaces', () => {
    for (const path of ['src/renderer/src/App.tsx', 'mobile/App.tsx']) {
      const app = source(path);
      expect(app).toContain('shared/workspaceModes');
      expect(app).toContain('workspaceTabForMode(');
      expect(app).toContain('Open in editor');
    }
  });

  it('retains mobile studios within one project, hides them from accessibility, and pauses hidden editing', () => {
    const app = source('mobile/App.tsx');
    for (const tab of ['edit', 'writer', 'video', 'voice', 'image']) {
      expect(app).toContain(`<RetainedScreen active={tab === '${tab}'}>`);
    }
    expect(app).toContain('key={route.projectId}');
    expect(app).toContain("importantForAccessibility={active ? 'auto' : 'no-hide-descendants'}");
    expect(source('mobile/src/screens/EditScreen.tsx')).toContain('if (!active) setPlaying(false)');
    expect(source('mobile/src/screens/EditScreen.tsx')).toContain('if (loadedSnapshot.current === snapshot) return');
  });

  it('opens the editor only after successful placement', () => {
    expect(source('mobile/src/screens/LibraryScreen.tsx')).toContain('if (placed) onOpenEditor?.()');
    expect(source('src/renderer/src/VideoGenerationWorkspace.tsx')).toContain('if (placed) onOpenEditor?.()');
  });
});
