import { describe, expect, it } from 'vitest';

import { APP_PAGE_BY_ID, APP_PAGE_IDS, APP_PAGES, getDefaultAppPageId, isWorkspacePageId } from '../src/renderer/src/appPages';
import { APP_WORKSPACE_IDS, APP_WORKSPACES, getDefaultAppWorkspaceId } from '../src/renderer/src/appWorkspaces';

describe('app workspaces', () => {
  it('returns a stable three-workspace model without Settings or Prompt Studio', () => {
    const workspaces = APP_WORKSPACES;

    expect(APP_WORKSPACE_IDS).toEqual(['edit', 'voice-generation', 'video-generation']);
    expect(getDefaultAppWorkspaceId()).toBe('edit');
    expect(workspaces.map((workspace) => workspace.id)).toEqual(APP_WORKSPACE_IDS);
    expect(workspaces.map((workspace) => workspace.label)).toEqual(['Editing', 'Voice Generation', 'Video Generation']);
    expect(workspaces.map((workspace) => workspace.navId)).toEqual([
      'app-workspace-nav-edit',
      'app-workspace-nav-voice-generation',
      'app-workspace-nav-video-generation'
    ]);
    expect(workspaces.map((workspace) => workspace.panelId)).toEqual([
      'app-workspace-panel-edit',
      'app-workspace-panel-voice-generation',
      'app-workspace-panel-video-generation'
    ]);
    expect(workspaces.map((workspace) => workspace.statusLabel)).toEqual(['Local timeline', 'Local narration', 'Result studio']);
  });

  it('returns a stable page model with Home as the initial page and Settings outside workspaces', () => {
    const pages = APP_PAGES;

    expect(APP_PAGE_IDS).toEqual(['home', 'edit', 'voice-generation', 'video-generation', 'settings']);
    expect(getDefaultAppPageId()).toBe('home');
    expect(pages.map((page) => page.id)).toEqual(APP_PAGE_IDS);
    expect(pages.map((page) => page.label)).toEqual(['Home', 'Editing', 'Voice Generation', 'Video Generation', 'Settings']);
    expect(APP_PAGE_BY_ID.settings.panelId).toBe('app-page-panel-settings');
    expect(isWorkspacePageId('home')).toBe(false);
    expect(isWorkspacePageId('edit')).toBe(true);
    expect(isWorkspacePageId('voice-generation')).toBe(true);
    expect(isWorkspacePageId('video-generation')).toBe(true);
    expect(isWorkspacePageId('settings')).toBe(false);
  });
});
