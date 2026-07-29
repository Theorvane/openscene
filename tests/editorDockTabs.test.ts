import { describe, expect, it } from 'vitest';

import {
  filterPendingAssetsForDock,
  getDefaultEditorDockTabs,
  getDefaultEditorLeftDockTabId,
  getNextEditorDockTabId
} from '../src/renderer/src/editor/dockTabs';
import { createInitialTimeline } from '../src/shared/timelineLogic';
import type { LocalProjectSnapshot, MediaAsset } from '../src/shared/timelineTypes';

function makeAsset(overrides: Partial<MediaAsset> = {}): MediaAsset {
  return {
    byteLength: 1_024,
    createdAt: '2026-07-20T10:00:00.000Z',
    displayName: 'take.webm',
    id: 'asset-1',
    kind: 'video',
    metadata: { durationMs: 4_000, width: 1_920, height: 1_080 },
    mimeType: 'video/webm',
    projectRelativePath: 'assets/asset-1/original.webm',
    updatedAt: '2026-07-20T10:00:00.000Z',
    ...overrides
  };
}

function makeProject(overrides: Partial<LocalProjectSnapshot> = {}): LocalProjectSnapshot {
  return {
    assets: [
      makeAsset({ id: 'asset-ready', displayName: 'ready.webm' }),
      makeAsset({ id: 'asset-pending', displayName: 'pending.webm', metadata: null })
    ],
    createdAt: '2026-07-20T10:00:00.000Z',
    id: 'project-1',
    name: 'Launch reel',
    schemaVersion: 3,
    timeline: createInitialTimeline(),
    updatedAt: '2026-07-20T10:00:00.000Z',
    ...overrides
  };
}

describe('editor dock tabs', () => {
  it('returns the media bin plus the generation studios, and the inspector defaults', () => {
    // Given
    const project = makeProject();

    // When
    const dockTabs = getDefaultEditorDockTabs(project);

    // Then
    expect(dockTabs.left.map((tab) => tab.id)).toEqual(['media', 'voice', 'video']);
    expect(dockTabs.left.map((tab) => tab.label)).toEqual(['Media', 'Voice', 'Video']);
    expect(dockTabs.left.every((tab) => tab.disabled !== true)).toBe(true);
    expect(dockTabs.inspector.map((tab) => tab.id)).toEqual(['selection', 'asset', 'project']);
    expect(dockTabs.inspector.map((tab) => tab.label)).toEqual(['Selection', 'Asset', 'Project']);
  });

  it('disables the generation studios until a project is open, since results import into one', () => {
    const dockTabs = getDefaultEditorDockTabs(null);

    expect(dockTabs.left.map((tab) => tab.disabled === true)).toEqual([false, true, true]);
  });

  it('moves focus across enabled tabs with wrap, Home, and End while skipping disabled tabs', () => {
    // Given
    const dockTabs = getDefaultEditorDockTabs(makeProject());
    const tabs = [
      ...dockTabs.left,
      { id: 'inspector', label: 'Inspector', disabled: true },
      ...dockTabs.inspector
    ] as const;

    // When / Then
    expect(getNextEditorDockTabId({ currentTabId: 'media', key: 'ArrowRight', tabs })).toBe('voice');
    expect(getNextEditorDockTabId({ currentTabId: 'video', key: 'ArrowRight', tabs })).toBe('selection');
    expect(getNextEditorDockTabId({ currentTabId: 'project', key: 'ArrowRight', tabs })).toBe('media');
    expect(getNextEditorDockTabId({ currentTabId: 'media', key: 'ArrowLeft', tabs })).toBe('project');
    expect(getNextEditorDockTabId({ currentTabId: 'voice', key: 'Home', tabs })).toBe('media');
    expect(getNextEditorDockTabId({ currentTabId: 'media', key: 'End', tabs })).toBe('project');
    expect(getNextEditorDockTabId({ currentTabId: 'selection', key: 'ArrowLeft', tabs })).toBe('video');
    expect(getNextEditorDockTabId({ currentTabId: 'inspector', key: 'ArrowRight', tabs })).toBe('selection');
  });

  it('filters out assets whose browser metadata is still pending', () => {
    // Given
    const project = makeProject();

    // When
    const readyAssets = filterPendingAssetsForDock(project.assets);

    // Then
    expect(readyAssets.map((asset) => asset.id)).toEqual(['asset-ready']);
    expect(readyAssets[0]?.metadata).toEqual({ durationMs: 4_000, width: 1_920, height: 1_080 });
  });

  it('returns the dock to the media bin whether or not a project is open', () => {
    // Given / When / Then
    expect(getDefaultEditorLeftDockTabId({ hasProject: false })).toBe('media');
    expect(getDefaultEditorLeftDockTabId({ hasProject: true })).toBe('media');
  });
});
