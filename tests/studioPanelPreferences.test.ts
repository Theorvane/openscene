import { describe, expect, it } from 'vitest';

import {
  STUDIO_PANEL_DEFAULT_PREFERENCE,
  STUDIO_PANEL_DEFAULT_WIDTH,
  STUDIO_PANEL_MAX_WIDTH,
  STUDIO_PANEL_MIN_WIDTH,
  STUDIO_PANEL_STORAGE_KEY,
  clampStudioPanelWidth,
  getNextStudioPanelWidthFromKey,
  parseStudioPanelPreference,
  serializeStudioPanelPreference
} from '../src/renderer/src/studioPanelPreferences';

describe('generation studio panel layout', () => {
  it('starts collapsed on Voice under its own storage key', () => {
    // Collapsed by default so the editor keeps the screen until it is opened.
    expect(STUDIO_PANEL_DEFAULT_PREFERENCE).toEqual({
      schemaVersion: 1,
      width: STUDIO_PANEL_DEFAULT_WIDTH,
      collapsed: true,
      tabId: 'voice'
    });
    // A key of its own, so it never collides with the chat panel's layout.
    expect(STUDIO_PANEL_STORAGE_KEY).toBe('openvideo-studio-panel-layout');
  });

  it('clamps the width into range and leaves the workspace usable', () => {
    expect(clampStudioPanelWidth(10)).toBe(STUDIO_PANEL_MIN_WIDTH);
    expect(clampStudioPanelWidth(9_000)).toBe(STUDIO_PANEL_MAX_WIDTH);
    expect(clampStudioPanelWidth(360.4)).toBe(360);
    // In a 1000px shell the panel gives up width so the workspace keeps 620px.
    expect(clampStudioPanelWidth(STUDIO_PANEL_MAX_WIDTH, 1_000)).toBe(380);
  });

  it('round trips through storage and falls back on anything unusable', () => {
    const stored = serializeStudioPanelPreference({ schemaVersion: 1, width: 420, collapsed: false, tabId: 'video' });

    expect(parseStudioPanelPreference(stored)).toEqual({ schemaVersion: 1, width: 420, collapsed: false, tabId: 'video' });
    expect(parseStudioPanelPreference(null)).toEqual(STUDIO_PANEL_DEFAULT_PREFERENCE);
    expect(parseStudioPanelPreference('not json')).toEqual(STUDIO_PANEL_DEFAULT_PREFERENCE);
    expect(parseStudioPanelPreference(JSON.stringify({ schemaVersion: 99, width: 420 }))).toEqual(STUDIO_PANEL_DEFAULT_PREFERENCE);
    // An unknown tab id falls back rather than rendering an empty section.
    expect(parseStudioPanelPreference(JSON.stringify({ schemaVersion: 1, width: 400, collapsed: false, tabId: 'audio' })).tabId).toBe('voice');
  });

  it('resizes from the leading edge, mirroring the chat panel', () => {
    // Docked left, so ArrowRight grows the panel.
    expect(getNextStudioPanelWidthFromKey({ currentWidth: 360, key: 'ArrowRight', shiftKey: false })).toBe(376);
    expect(getNextStudioPanelWidthFromKey({ currentWidth: 360, key: 'ArrowLeft', shiftKey: false })).toBe(344);
    expect(getNextStudioPanelWidthFromKey({ currentWidth: 360, key: 'ArrowRight', shiftKey: true })).toBe(408);
    expect(getNextStudioPanelWidthFromKey({ currentWidth: 360, key: 'Home', shiftKey: false })).toBe(STUDIO_PANEL_MIN_WIDTH);
    expect(getNextStudioPanelWidthFromKey({ currentWidth: 360, key: 'End', shiftKey: false })).toBe(STUDIO_PANEL_MAX_WIDTH);
    expect(getNextStudioPanelWidthFromKey({ currentWidth: 420, key: 'Enter', shiftKey: false })).toBe(STUDIO_PANEL_DEFAULT_WIDTH);
    expect(getNextStudioPanelWidthFromKey({ currentWidth: 360, key: 'Tab', shiftKey: false })).toBeNull();
  });
});
