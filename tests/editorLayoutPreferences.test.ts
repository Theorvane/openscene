import { describe, expect, it } from 'vitest';

import {
  clampEditorInspectorWidth,
  clampEditorLeftDockWidth,
  clampEditorProgramPercent,
	EDITOR_LAYOUT_DEFAULT_INSPECTOR_WIDTH,
	EDITOR_LAYOUT_DEFAULT_LEFT_DOCK_WIDTH,
	EDITOR_LAYOUT_FLOATING_PANEL_DEFAULTS,
	EDITOR_LAYOUT_DEFAULT_PREFERENCE,
  EDITOR_LAYOUT_MAX_INSPECTOR_WIDTH,
  EDITOR_LAYOUT_MAX_LEFT_DOCK_WIDTH,
  EDITOR_LAYOUT_MAX_PROGRAM_PERCENT,
  EDITOR_LAYOUT_MIN_INSPECTOR_WIDTH,
  EDITOR_LAYOUT_MIN_LEFT_DOCK_WIDTH,
  EDITOR_LAYOUT_MIN_PROGRAM_PERCENT,
  EDITOR_LAYOUT_STORAGE_KEY,
  getNextEditorProgramPercentFromKey,
  getNextEditorSidebarWidthFromKey,
  parseEditorLayoutPreference,
  serializeEditorLayoutPreference,
  resetEditorLayoutPreference,
  setEditorInspectorPlacement,
  toggleEditorInspector,
  toggleEditorLeftDock
} from '../src/renderer/src/editor/editorLayoutPreferences';

describe('editor layout preferences', () => {
  it('Given the approved storage key, When referenced, Then it keeps the editor layout namespace across schema versions', () => {
    expect(EDITOR_LAYOUT_STORAGE_KEY).toBe('window-loom-editor-layout');
  });

  it('Given missing or malformed storage, When parsed, Then defaults keep sidebars visible with the v3 dimensions', () => {
    expect(parseEditorLayoutPreference(null)).toEqual(EDITOR_LAYOUT_DEFAULT_PREFERENCE);
    expect(parseEditorLayoutPreference('{')).toEqual(EDITOR_LAYOUT_DEFAULT_PREFERENCE);
    expect(parseEditorLayoutPreference(JSON.stringify({ schemaVersion: 4, leftDock: { visible: false } }))).toEqual(EDITOR_LAYOUT_DEFAULT_PREFERENCE);
  });

  it('Given a v1 stored layout, When parsed, Then visibility and program split migrate into the v3 defaults', () => {
    expect(parseEditorLayoutPreference(JSON.stringify({
      schemaVersion: 1,
      leftDockVisible: false,
      inspectorVisible: true,
      programPercent: 12
    }))).toEqual({
      ...EDITOR_LAYOUT_DEFAULT_PREFERENCE,
      leftDockVisible: false,
      inspectorVisible: true,
      programPercent: EDITOR_LAYOUT_MIN_PROGRAM_PERCENT
    });
  });

  it('Given stored v2 layout values, When parsed, Then widths and program percentages are clamped into the normalized v3 preference', () => {
    expect(parseEditorLayoutPreference(JSON.stringify({
      schemaVersion: 2,
      leftDockVisible: true,
      inspectorVisible: false,
      inspectorPlacement: 'left',
      leftDockWidth: 120,
      inspectorWidth: 900,
      programPercent: 92
    }))).toEqual({
      schemaVersion: 4,
      leftDockVisible: true,
      inspectorVisible: false,
		inspectorPlacement: 'left',
		leftDockWidth: EDITOR_LAYOUT_MIN_LEFT_DOCK_WIDTH,
		inspectorWidth: EDITOR_LAYOUT_MAX_INSPECTOR_WIDTH,
		programPercent: EDITOR_LAYOUT_MAX_PROGRAM_PERCENT,
		floatingPanels: EDITOR_LAYOUT_FLOATING_PANEL_DEFAULTS
	});
  });

  it('Given a normalized v3 preference, When serialized, Then storage upgrades to the v3 panel model', () => {
    expect(JSON.parse(serializeEditorLayoutPreference(EDITOR_LAYOUT_DEFAULT_PREFERENCE))).toEqual({
      schemaVersion: 4,
      leftDock: {
        visible: true,
        width: EDITOR_LAYOUT_DEFAULT_LEFT_DOCK_WIDTH
      },
      inspector: {
        visible: true,
        placement: 'right',
        width: EDITOR_LAYOUT_DEFAULT_INSPECTOR_WIDTH
      },
		program: {
			percent: EDITOR_LAYOUT_DEFAULT_PREFERENCE.programPercent
		},
		floatingPanels: EDITOR_LAYOUT_FLOATING_PANEL_DEFAULTS
	});
  });

  it('Given current layout state, When toggled or reset, Then only the requested preference changes', () => {
    const hiddenLeftDock = toggleEditorLeftDock(EDITOR_LAYOUT_DEFAULT_PREFERENCE);
    const hiddenInspector = toggleEditorInspector(hiddenLeftDock);
    const leftInspector = setEditorInspectorPlacement(hiddenInspector, 'left');
    const floatingInspector = setEditorInspectorPlacement(leftInspector, 'floating');

    expect(hiddenLeftDock).toEqual({ ...EDITOR_LAYOUT_DEFAULT_PREFERENCE, leftDockVisible: false });
    expect(hiddenInspector).toEqual({ ...EDITOR_LAYOUT_DEFAULT_PREFERENCE, leftDockVisible: false, inspectorVisible: false });
    expect(leftInspector).toEqual({ ...EDITOR_LAYOUT_DEFAULT_PREFERENCE, leftDockVisible: false, inspectorPlacement: 'left', inspectorVisible: true });
    expect(floatingInspector).toEqual({
      ...EDITOR_LAYOUT_DEFAULT_PREFERENCE,
      leftDockVisible: false,
      inspectorPlacement: 'floating',
      inspectorVisible: true,
      floatingPanels: {
        ...EDITOR_LAYOUT_DEFAULT_PREFERENCE.floatingPanels,
        inspector: {
          ...EDITOR_LAYOUT_DEFAULT_PREFERENCE.floatingPanels.inspector,
          floating: true
        }
      }
    });
    expect(resetEditorLayoutPreference()).toEqual(EDITOR_LAYOUT_DEFAULT_PREFERENCE);
  });

  it('Given splitter keyboard input, When Arrow, Shift, Home, End, or Enter is pressed, Then the next percent follows the accessibility contract', () => {
    expect(getNextEditorProgramPercentFromKey({ currentPercent: 58, key: 'ArrowUp', shiftKey: false })).toBe(56);
    expect(getNextEditorProgramPercentFromKey({ currentPercent: 58, key: 'ArrowDown', shiftKey: false })).toBe(60);
    expect(getNextEditorProgramPercentFromKey({ currentPercent: 58, key: 'ArrowUp', shiftKey: true })).toBe(48);
    expect(getNextEditorProgramPercentFromKey({ currentPercent: 58, key: 'ArrowDown', shiftKey: true })).toBe(68);
    expect(getNextEditorProgramPercentFromKey({ currentPercent: 58, key: 'Home', shiftKey: false })).toBe(EDITOR_LAYOUT_MIN_PROGRAM_PERCENT);
    expect(getNextEditorProgramPercentFromKey({ currentPercent: 58, key: 'End', shiftKey: false })).toBe(EDITOR_LAYOUT_MAX_PROGRAM_PERCENT);
    // Enter resets to the default split, which now favours the timeline.
    expect(getNextEditorProgramPercentFromKey({ currentPercent: 47, key: 'Enter', shiftKey: false })).toBe(45);
    expect(getNextEditorProgramPercentFromKey({ currentPercent: 47, key: 'Escape', shiftKey: false })).toBeNull();
  });

  it('Given pointer percentages outside the desktop split range, When clamped, Then they stay within the approved 35 to 75 bounds', () => {
    expect(clampEditorProgramPercent(10)).toBe(EDITOR_LAYOUT_MIN_PROGRAM_PERCENT);
    expect(clampEditorProgramPercent(80)).toBe(EDITOR_LAYOUT_MAX_PROGRAM_PERCENT);
    expect(clampEditorProgramPercent(61.4)).toBe(61);
  });

  it('Given sidebar pointer widths outside the desktop range, When clamped, Then they stay within the persisted dock bounds', () => {
    expect(clampEditorLeftDockWidth(120)).toBe(EDITOR_LAYOUT_MIN_LEFT_DOCK_WIDTH);
    expect(clampEditorLeftDockWidth(900)).toBe(EDITOR_LAYOUT_MAX_LEFT_DOCK_WIDTH);
    expect(clampEditorInspectorWidth(120)).toBe(EDITOR_LAYOUT_MIN_INSPECTOR_WIDTH);
    expect(clampEditorInspectorWidth(900)).toBe(EDITOR_LAYOUT_MAX_INSPECTOR_WIDTH);
  });

  it('Given vertical splitter keyboard input, When Arrow, Shift, Home, End, or Enter is pressed, Then sidebar widths follow the a11y contract', () => {
    expect(getNextEditorSidebarWidthFromKey({ currentWidth: 320, key: 'ArrowLeft', shiftKey: false, side: 'left-dock' })).toBe(304);
    expect(getNextEditorSidebarWidthFromKey({ currentWidth: 320, key: 'ArrowRight', shiftKey: false, side: 'left-dock' })).toBe(336);
    expect(getNextEditorSidebarWidthFromKey({ currentWidth: 340, key: 'ArrowLeft', shiftKey: true, side: 'inspector-right' })).toBe(388);
    expect(getNextEditorSidebarWidthFromKey({ currentWidth: 340, key: 'ArrowRight', shiftKey: true, side: 'inspector-right' })).toBe(292);
    expect(getNextEditorSidebarWidthFromKey({ currentWidth: 340, key: 'Home', shiftKey: false, side: 'inspector-left' })).toBe(EDITOR_LAYOUT_MIN_INSPECTOR_WIDTH);
    expect(getNextEditorSidebarWidthFromKey({ currentWidth: 340, key: 'End', shiftKey: false, side: 'inspector-left' })).toBe(EDITOR_LAYOUT_MAX_INSPECTOR_WIDTH);
    expect(getNextEditorSidebarWidthFromKey({ currentWidth: 399, key: 'Enter', shiftKey: false, side: 'left-dock' })).toBe(EDITOR_LAYOUT_DEFAULT_LEFT_DOCK_WIDTH);
    expect(getNextEditorSidebarWidthFromKey({ currentWidth: 399, key: 'Enter', shiftKey: false, side: 'inspector-left' })).toBe(EDITOR_LAYOUT_DEFAULT_INSPECTOR_WIDTH);
    expect(getNextEditorSidebarWidthFromKey({ currentWidth: 320, key: 'Escape', shiftKey: false, side: 'left-dock' })).toBeNull();
  });
});
