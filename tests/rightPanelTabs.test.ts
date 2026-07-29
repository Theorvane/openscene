import { describe, expect, it } from 'vitest';

import {
  RIGHT_PANEL_DEFAULT_TAB_ID,
  RIGHT_PANEL_TAB_IDS,
  RIGHT_PANEL_TAB_STORAGE_KEY,
  isRightPanelTabId,
  parseRightPanelTabId
} from '../src/renderer/src/rightPanelTabs';

describe('workspace side panel tabs', () => {
  it('offers chat plus the two generation studios, starting on chat', () => {
    expect(RIGHT_PANEL_TAB_IDS).toEqual(['chat', 'voice', 'video']);
    expect(RIGHT_PANEL_DEFAULT_TAB_ID).toBe('chat');
    expect(RIGHT_PANEL_TAB_STORAGE_KEY).toBe('openvideo-right-panel-tab');
  });

  it('falls back to chat for anything unrecognised rather than an empty panel', () => {
    expect(parseRightPanelTabId('video')).toBe('video');
    expect(parseRightPanelTabId('voice')).toBe('voice');
    expect(parseRightPanelTabId(null)).toBe('chat');
    expect(parseRightPanelTabId(undefined)).toBe('chat');
    // A tab id from an older or newer build must not blank the panel.
    expect(parseRightPanelTabId('studio')).toBe('chat');
    expect(isRightPanelTabId('studio')).toBe(false);
    expect(isRightPanelTabId('chat')).toBe(true);
  });
});
