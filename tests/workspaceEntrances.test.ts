import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { WORKSPACE_EXPERIENCES, WORKSPACE_MODES, workspaceModeForTab } from '../src/shared/workspaceModes';

describe('product workspace entrances', () => {
  it.each(WORKSPACE_MODES)('%s opens its own workspace', mode => {
    const experience = WORKSPACE_EXPERIENCES[mode];
    expect(workspaceModeForTab(experience.entryTab)).toBe(mode);
    expect(experience.description.length).toBeGreaterThan(10);
    expect(experience.tools.length).toBeGreaterThan(10);
  });
  it('both home screens pass the selected entrance when opening projects', () => {
    const desktop = readFileSync('src/renderer/src/ProjectsPage.tsx', 'utf8');
    const mobile = readFileSync('mobile/src/screens/ProjectsScreen.tsx', 'utf8');
    expect(desktop).toContain('onOpenProject?.(item.id, entrance)');
    expect(desktop).toContain('onOpenProjectFolder?.(entrance)');
    expect(mobile).toContain('onOpen(project.id, entrance)');
    for (const source of [desktop, mobile]) {
      expect(source).toContain('WORKSPACE_EXPERIENCES[mode].description');
      expect(source).not.toContain('aiGenerateVideo(');
    }
  });
});
