import { describe, expect, it } from 'vitest';

import {
  EDITOR_LAYOUT_DEFAULT_INSPECTOR_WIDTH,
  EDITOR_LAYOUT_DEFAULT_LEFT_DOCK_WIDTH,
  EDITOR_LAYOUT_DEFAULT_PREFERENCE,
  EDITOR_LAYOUT_FLOATING_PRESETS,
  EDITOR_LAYOUT_FLOATING_PANEL_DEFAULTS,
  EDITOR_LAYOUT_MAX_INSPECTOR_WIDTH,
  EDITOR_LAYOUT_MAX_LEFT_DOCK_WIDTH,
  EDITOR_LAYOUT_MAX_PROGRAM_PERCENT,
  EDITOR_LAYOUT_MIN_INSPECTOR_WIDTH,
  EDITOR_LAYOUT_MIN_LEFT_DOCK_WIDTH,
  EDITOR_LAYOUT_MIN_PROGRAM_PERCENT,
  EDITOR_PANEL_LAYOUT_DEFAULT,
  expandEditorLayoutPreference,
  flattenEditorPanelLayout,
  getEditorFloatingPanelAfterKeyboardMove,
  parseEditorPanelLayout,
  setEditorFloatingPanelMode,
  type EditorPanelLayout
} from '../src/renderer/src/editor/editorPanelLayout';

describe('editor panel layout v3 model', () => {
  it('Given a v1 stored layout, When parsed, Then it migrates into the nested v3 panel model', () => {
    expect(parseEditorPanelLayout(JSON.stringify({
      schemaVersion: 1,
      leftDockVisible: false,
      inspectorVisible: true,
      programPercent: 12
    }))).toEqual({
      schemaVersion: 4,
      leftDock: {
        visible: false,
        width: EDITOR_LAYOUT_DEFAULT_LEFT_DOCK_WIDTH
      },
      inspector: {
        visible: true,
        placement: 'right',
        width: EDITOR_LAYOUT_DEFAULT_INSPECTOR_WIDTH
      },
      program: {
        percent: EDITOR_LAYOUT_MIN_PROGRAM_PERCENT
      },
      floatingPanels: EDITOR_LAYOUT_FLOATING_PANEL_DEFAULTS
    });
  });

  it('Given a v3 layout without floating panels, When parsed, Then it upgrades to docked floating defaults', () => {
    expect(parseEditorPanelLayout(JSON.stringify({
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
        percent: 62
      }
    }))).toEqual({
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
        percent: 62
      },
      floatingPanels: EDITOR_LAYOUT_FLOATING_PANEL_DEFAULTS
    });
  });

  it('Given a v2 stored layout, When parsed, Then widths and program percent are clamped in the v3 panel model', () => {
    expect(parseEditorPanelLayout(JSON.stringify({
      schemaVersion: 2,
      leftDockVisible: true,
      inspectorVisible: false,
      inspectorPlacement: 'left',
      leftDockWidth: 120,
      inspectorWidth: 900,
      programPercent: 92
    }))).toEqual({
      schemaVersion: 4,
      leftDock: {
        visible: true,
        width: EDITOR_LAYOUT_MIN_LEFT_DOCK_WIDTH
      },
      inspector: {
        visible: false,
        placement: 'left',
        width: EDITOR_LAYOUT_MAX_INSPECTOR_WIDTH
      },
      program: {
        percent: EDITOR_LAYOUT_MAX_PROGRAM_PERCENT
      },
      floatingPanels: EDITOR_LAYOUT_FLOATING_PANEL_DEFAULTS
    });
  });

  it('Given stored floating panels, When parsed, Then panel rectangles are clamped and unknown panel state is rejected', () => {
    expect(parseEditorPanelLayout(JSON.stringify({
      schemaVersion: 4,
      leftDock: {
        visible: true,
        width: EDITOR_LAYOUT_DEFAULT_LEFT_DOCK_WIDTH
      },
      inspector: {
        visible: true,
        placement: 'floating',
        width: EDITOR_LAYOUT_DEFAULT_INSPECTOR_WIDTH
      },
      program: {
        percent: 58
      },
      floatingPanels: {
        ...EDITOR_LAYOUT_FLOATING_PANEL_DEFAULTS,
        inspector: {
          floating: true,
          height: 120,
          width: 900,
          x: -40,
          y: 4,
          zIndex: 500
        }
      }
    }))).toEqual({
      schemaVersion: 4,
      leftDock: {
        visible: true,
        width: EDITOR_LAYOUT_DEFAULT_LEFT_DOCK_WIDTH
      },
      inspector: {
        visible: true,
        placement: 'floating',
        width: EDITOR_LAYOUT_DEFAULT_INSPECTOR_WIDTH
      },
      program: {
        percent: 58
      },
      floatingPanels: {
        ...EDITOR_LAYOUT_FLOATING_PANEL_DEFAULTS,
        inspector: {
          floating: true,
          height: 240,
          width: 640,
          x: 8,
          y: 8,
          zIndex: 99
        }
      }
    });
  });

  it('Given a v3 stored layout, When parsed, Then docks carry over but the program split adopts the taller-timeline default', () => {
    const stored = parseEditorPanelLayout(JSON.stringify({
      schemaVersion: 3,
      leftDock: { visible: false, width: EDITOR_LAYOUT_MAX_LEFT_DOCK_WIDTH },
      inspector: { visible: true, placement: 'left', width: EDITOR_LAYOUT_MIN_INSPECTOR_WIDTH },
      program: { percent: 58 },
      floatingPanels: EDITOR_LAYOUT_FLOATING_PANEL_DEFAULTS
    }));

    // The user's own dock choices survive the migration...
    expect(stored.leftDock).toEqual({ visible: false, width: EDITOR_LAYOUT_MAX_LEFT_DOCK_WIDTH });
    expect(stored.inspector.placement).toBe('left');
    // ...but a stored v3 split would otherwise mask the new timeline size.
    expect(stored.program.percent).toBe(EDITOR_PANEL_LAYOUT_DEFAULT.program.percent);
    expect(stored.schemaVersion).toBe(4);
  });

  it('Given a v3 panel layout, When flattened and expanded, Then the editor preference round trips without drift', () => {
    const panelLayout: EditorPanelLayout = {
      schemaVersion: 4,
      leftDock: {
        visible: false,
        width: EDITOR_LAYOUT_MAX_LEFT_DOCK_WIDTH
      },
      inspector: {
        visible: true,
        placement: 'floating',
        width: EDITOR_LAYOUT_MIN_INSPECTOR_WIDTH
      },
      program: {
        percent: 63
      },
      floatingPanels: {
        ...EDITOR_LAYOUT_FLOATING_PANEL_DEFAULTS,
        project: {
          ...EDITOR_LAYOUT_FLOATING_PANEL_DEFAULTS.project,
          floating: true,
          zIndex: 14
        }
      }
    };

    const preference = flattenEditorPanelLayout(panelLayout);

    expect(preference).toEqual({
      schemaVersion: 4,
      leftDockVisible: false,
      inspectorVisible: true,
      inspectorPlacement: 'floating',
      leftDockWidth: EDITOR_LAYOUT_MAX_LEFT_DOCK_WIDTH,
      inspectorWidth: EDITOR_LAYOUT_MIN_INSPECTOR_WIDTH,
      programPercent: 63,
      floatingPanels: panelLayout.floatingPanels
    });
    expect(expandEditorLayoutPreference(preference)).toEqual(panelLayout);
  });

  it('Given a current layout, When a panel is floated and moved by keyboard, Then it stays visible and within the canvas bounds', () => {
    const floatedLayout = setEditorFloatingPanelMode(EDITOR_LAYOUT_DEFAULT_PREFERENCE, 'project', true);
    const movedPanel = getEditorFloatingPanelAfterKeyboardMove({
      key: 'ArrowRight',
      panel: floatedLayout.floatingPanels.project,
      shiftKey: true
    });

    expect(floatedLayout.leftDockVisible).toBe(true);
    expect(floatedLayout.floatingPanels.project.floating).toBe(true);
    expect(movedPanel).toEqual({
      ...floatedLayout.floatingPanels.project,
      x: floatedLayout.floatingPanels.project.x + 48
    });
  });

  it('Given a named floating preset, When applied, Then it stores the preset panel positions by name', () => {
    expect(EDITOR_LAYOUT_FLOATING_PRESETS.reviewDeck.label).toBe('Review deck');
    expect(EDITOR_LAYOUT_FLOATING_PRESETS.reviewDeck.floatingPanels.program.floating).toBe(true);
    expect(EDITOR_LAYOUT_FLOATING_PRESETS.reviewDeck.floatingPanels.inspector.floating).toBe(true);
  });

  it('Given missing or malformed storage, When parsed, Then the default v3 panel layout is returned', () => {
    expect(parseEditorPanelLayout(null)).toEqual({
      schemaVersion: 4,
      leftDock: {
        visible: EDITOR_LAYOUT_DEFAULT_PREFERENCE.leftDockVisible,
        width: EDITOR_LAYOUT_DEFAULT_LEFT_DOCK_WIDTH
      },
      inspector: {
        visible: EDITOR_LAYOUT_DEFAULT_PREFERENCE.inspectorVisible,
        placement: EDITOR_LAYOUT_DEFAULT_PREFERENCE.inspectorPlacement,
        width: EDITOR_LAYOUT_DEFAULT_INSPECTOR_WIDTH
      },
      program: {
        percent: EDITOR_LAYOUT_DEFAULT_PREFERENCE.programPercent
      },
      floatingPanels: EDITOR_LAYOUT_FLOATING_PANEL_DEFAULTS
    });
  });
});
