import { describe, expect, it } from 'vitest';

import {
  WORKSPACE_DEFAULT_TAB_ID,
  WORKSPACE_TAB_IDS,
  WORKSPACE_TAB_LABELS,
  WORKSPACE_TAB_STORAGE_KEY,
  isWorkspaceTabId,
  parseWorkspaceTabId
} from '../src/renderer/src/workspaceTabs';

describe('workspace tabs', () => {
  it('switches between the editor and the two generation studios, starting on the editor', () => {
    expect(WORKSPACE_TAB_IDS).toEqual(['edit', 'voice', 'video']);
    expect(WORKSPACE_DEFAULT_TAB_ID).toBe('edit');
    expect(WORKSPACE_TAB_IDS.map((id) => WORKSPACE_TAB_LABELS[id])).toEqual([
      'Editing',
      'Voice Generation',
      'Video Generation'
    ]);
    expect(WORKSPACE_TAB_STORAGE_KEY).toBe('openvideo-workspace-tab');
  });

  it('falls back to the editor for anything unrecognised rather than a blank area', () => {
    expect(parseWorkspaceTabId('voice')).toBe('voice');
    expect(parseWorkspaceTabId('video')).toBe('video');
    expect(parseWorkspaceTabId(null)).toBe('edit');
    expect(parseWorkspaceTabId(undefined)).toBe('edit');
    // A tab id from an older or newer build must not blank the workspace.
    expect(parseWorkspaceTabId('voice-generation')).toBe('edit');
    expect(isWorkspaceTabId('voice-generation')).toBe(false);
    expect(isWorkspaceTabId('edit')).toBe(true);
  });
});
