import { describe, expect, it } from 'vitest';

import {
  APP_WORKSPACE_IDS,
  APP_WORKSPACES,
  getDefaultAppWorkspaceId,
  getNextAppWorkspaceId
} from '../src/renderer/src/appWorkspaces';

describe('app workspaces', () => {
  it('returns a stable ordered workspace model that defaults to edit', () => {
    // Given / When
    const workspaces = APP_WORKSPACES;

    // Then
    expect(APP_WORKSPACE_IDS).toEqual(['edit', 'video-generation', 'voice-generation', 'settings']);
    expect(getDefaultAppWorkspaceId()).toBe('edit');
    expect(workspaces.map((workspace) => workspace.id)).toEqual(APP_WORKSPACE_IDS);
    expect(workspaces.map((workspace) => workspace.label)).toEqual(['Edit Timeline', 'AI Video Studio', 'AI Voice Studio', 'Settings']);
    expect(workspaces.map((workspace) => workspace.navId)).toEqual([
      'app-workspace-nav-edit',
      'app-workspace-nav-video-generation',
      'app-workspace-nav-voice-generation',
      'app-workspace-nav-settings'
    ]);
    expect(workspaces.map((workspace) => workspace.panelId)).toEqual([
      'app-workspace-panel-edit',
      'app-workspace-panel-video-generation',
      'app-workspace-panel-voice-generation',
      'app-workspace-panel-settings'
    ]);
    expect(workspaces.map((workspace) => workspace.statusLabel)).toEqual([
      'Local NLE',
      'Local & API',
      'Local & API',
      'Preferences'
    ]);
  });

  it('moves focus across workspaces with ArrowUp, ArrowDown, Home, and End wrap', () => {
    // Given / When / Then
    expect(getNextAppWorkspaceId({ currentWorkspaceId: 'edit', key: 'ArrowDown' })).toBe('video-generation');
    expect(getNextAppWorkspaceId({ currentWorkspaceId: 'video-generation', key: 'ArrowDown' })).toBe('voice-generation');
    expect(getNextAppWorkspaceId({ currentWorkspaceId: 'voice-generation', key: 'ArrowDown' })).toBe('settings');
    expect(getNextAppWorkspaceId({ currentWorkspaceId: 'settings', key: 'ArrowDown' })).toBe('edit');
    expect(getNextAppWorkspaceId({ currentWorkspaceId: 'edit', key: 'ArrowUp' })).toBe('settings');
    expect(getNextAppWorkspaceId({ currentWorkspaceId: 'settings', key: 'ArrowUp' })).toBe('voice-generation');
    expect(getNextAppWorkspaceId({ currentWorkspaceId: 'settings', key: 'Home' })).toBe('edit');
    expect(getNextAppWorkspaceId({ currentWorkspaceId: 'edit', key: 'End' })).toBe('settings');
  });
});
