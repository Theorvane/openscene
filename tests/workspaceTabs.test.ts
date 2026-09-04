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
  it('switches between the editor, Writer, and the three generation studios, starting on the editor', () => {
    // Image sits last because it feeds the others: a generated still is usually
    // the seed for image-to-video rather than the finished artefact.
    expect(WORKSPACE_TAB_IDS).toEqual(['edit', 'writer', 'voice', 'video', 'image']);
    expect(WORKSPACE_DEFAULT_TAB_ID).toBe('edit');
    expect(WORKSPACE_TAB_IDS.map((id) => WORKSPACE_TAB_LABELS[id])).toEqual([
      'Editing',
      'Writer',
      'Voice Generation',
      'Video Generation',
      'Image Generation'
    ]);
    expect(WORKSPACE_TAB_STORAGE_KEY).toBe('openvideo-workspace-tab');
  });

  it('falls back to the editor for anything unrecognised rather than a blank area', () => {
    expect(parseWorkspaceTabId('voice')).toBe('voice');
    expect(parseWorkspaceTabId('writer')).toBe('writer');
    expect(parseWorkspaceTabId('video')).toBe('video');
    expect(parseWorkspaceTabId('image')).toBe('image');
    expect(parseWorkspaceTabId(null)).toBe('edit');
    expect(parseWorkspaceTabId(undefined)).toBe('edit');
    // A tab id from an older or newer build must not blank the workspace.
    expect(parseWorkspaceTabId('voice-generation')).toBe('edit');
    expect(isWorkspaceTabId('voice-generation')).toBe(false);
    expect(isWorkspaceTabId('edit')).toBe(true);
  });
});
