import { describe, expect, it } from 'vitest';
import { CREATION_TOOLS, WORKSPACE_MODES, isCreationTool, isTabInWorkspace, workspaceModeForTab, workspaceTabForMode } from '../src/shared/workspaceModes';
import { parseWorkspaceTabId, WORKSPACE_TAB_IDS } from '../src/renderer/src/workspaceTabs';

describe('shared editing and creation workspaces', () => {
  it('has exactly two modes and a direct video entry without requiring Writer', () => {
    expect(WORKSPACE_MODES).toEqual(['edit', 'create']);
    expect(CREATION_TOOLS[0]).toBe('video');
    expect(workspaceTabForMode('create', 'video')).toBe('video');
  });

  it.each(WORKSPACE_TAB_IDS)('preserves the legacy %s preference and maps it to its mode', (tab) => {
    expect(parseWorkspaceTabId(tab)).toBe(tab);
    expect(workspaceModeForTab(tab)).toBe(tab === 'edit' ? 'edit' : 'create');
  });

  it.each(CREATION_TOOLS)('returns to %s after visiting the editor', (tool) => {
    expect(workspaceTabForMode('edit', tool)).toBe('edit');
    expect(workspaceTabForMode('create', tool)).toBe(tool);
    expect(isTabInWorkspace(tool, 'edit')).toBe(false);
    expect(isTabInWorkspace(tool, 'create')).toBe(true);
  });

  it('keeps shared library and assistant in either mode without changing the mode', () => {
    for (const mode of WORKSPACE_MODES) {
      for (const tab of ['library', 'agent']) {
        expect(isTabInWorkspace(tab, mode)).toBe(true);
        expect(workspaceModeForTab(tab, mode)).toBe(mode);
      }
    }
    expect(isTabInWorkspace('edit', 'create')).toBe(false);
    expect(isTabInWorkspace('edit', 'edit')).toBe(true);
  });

  it('rejects unknown tools and recovers invalid saved tabs to editing', () => {
    expect(isCreationTool(null)).toBe(false);
    expect(isCreationTool('unknown')).toBe(false);
    expect(isTabInWorkspace('unknown', 'create')).toBe(false);
    expect(workspaceModeForTab(parseWorkspaceTabId('unknown'))).toBe('edit');
  });
});
