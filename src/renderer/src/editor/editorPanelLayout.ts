export const EDITOR_LAYOUT_SCHEMA_VERSION = 3 as const;
export const EDITOR_LAYOUT_MIN_PROGRAM_PERCENT = 35;
export const EDITOR_LAYOUT_MAX_PROGRAM_PERCENT = 75;
export const EDITOR_LAYOUT_ARROW_STEP_PERCENT = 2;
export const EDITOR_LAYOUT_SHIFT_STEP_PERCENT = 10;
export const EDITOR_LAYOUT_MIN_LEFT_DOCK_WIDTH = 240;
export const EDITOR_LAYOUT_MAX_LEFT_DOCK_WIDTH = 420;
export const EDITOR_LAYOUT_DEFAULT_LEFT_DOCK_WIDTH = 280;
export const EDITOR_LAYOUT_MIN_INSPECTOR_WIDTH = 260;
export const EDITOR_LAYOUT_MAX_INSPECTOR_WIDTH = 460;
export const EDITOR_LAYOUT_DEFAULT_INSPECTOR_WIDTH = 300;
export const EDITOR_LAYOUT_SIDEBAR_ARROW_STEP = 16;
export const EDITOR_LAYOUT_SIDEBAR_SHIFT_STEP = 48;
export const EDITOR_LAYOUT_FLOATING_PANEL_MIN_X = 8;
export const EDITOR_LAYOUT_FLOATING_PANEL_MIN_Y = 8;
export const EDITOR_LAYOUT_FLOATING_PANEL_MAX_X = 880;
export const EDITOR_LAYOUT_FLOATING_PANEL_MAX_Y = 560;
export const EDITOR_LAYOUT_FLOATING_PANEL_MIN_WIDTH = 280;
export const EDITOR_LAYOUT_FLOATING_PANEL_MAX_WIDTH = 640;
export const EDITOR_LAYOUT_FLOATING_PANEL_MIN_HEIGHT = 240;
export const EDITOR_LAYOUT_FLOATING_PANEL_MAX_HEIGHT = 620;
export const EDITOR_LAYOUT_FLOATING_PANEL_MIN_Z_INDEX = 10;
export const EDITOR_LAYOUT_FLOATING_PANEL_MAX_Z_INDEX = 99;

export const EDITOR_INSPECTOR_PLACEMENTS = ['left', 'right', 'floating'] as const;
export const EDITOR_FLOATING_PANEL_IDS = ['project', 'program', 'inspector', 'export'] as const;

export type EditorInspectorPlacement = (typeof EDITOR_INSPECTOR_PLACEMENTS)[number];
export type EditorFloatingPanelId = (typeof EDITOR_FLOATING_PANEL_IDS)[number];

export type EditorFloatingPanel = {
  readonly floating: boolean;
  readonly height: number;
  readonly width: number;
  readonly x: number;
  readonly y: number;
  readonly zIndex: number;
};

export type EditorFloatingPanels = Readonly<Record<EditorFloatingPanelId, EditorFloatingPanel>>;

export type EditorLayoutPreference = {
  readonly schemaVersion: typeof EDITOR_LAYOUT_SCHEMA_VERSION;
  readonly leftDockVisible: boolean;
  readonly inspectorVisible: boolean;
  readonly inspectorPlacement: EditorInspectorPlacement;
  readonly leftDockWidth: number;
  readonly inspectorWidth: number;
  readonly programPercent: number;
  readonly floatingPanels: EditorFloatingPanels;
};

export type EditorPanelLayout = {
  readonly schemaVersion: typeof EDITOR_LAYOUT_SCHEMA_VERSION;
  readonly leftDock: {
    readonly visible: boolean;
    readonly width: number;
  };
  readonly inspector: {
    readonly visible: boolean;
    readonly placement: EditorInspectorPlacement;
    readonly width: number;
  };
  readonly program: {
    readonly percent: number;
  };
  readonly floatingPanels: EditorFloatingPanels;
};

export type EditorFloatingPresetId = 'compactReview' | 'reviewDeck';

export type EditorFloatingPreset = {
  readonly floatingPanels: EditorFloatingPanels;
  readonly label: string;
};

export type EditorFloatingPanelKeyboardMoveInput = {
  readonly key: string;
  readonly panel: EditorFloatingPanel;
  readonly shiftKey: boolean;
};

export const EDITOR_LAYOUT_FLOATING_PANEL_DEFAULTS: EditorFloatingPanels = {
  project: {
    floating: false,
    height: 520,
    width: EDITOR_LAYOUT_DEFAULT_LEFT_DOCK_WIDTH,
    x: 16,
    y: 64,
    zIndex: 10
  },
  program: {
    floating: false,
    height: 420,
    width: EDITOR_LAYOUT_FLOATING_PANEL_MAX_WIDTH,
    x: 360,
    y: 56,
    zIndex: 11
  },
  inspector: {
    floating: false,
    height: 520,
    width: EDITOR_LAYOUT_DEFAULT_INSPECTOR_WIDTH,
    x: 720,
    y: 72,
    zIndex: 12
  },
  export: {
    floating: false,
    height: 300,
    width: 520,
    x: 520,
    y: 352,
    zIndex: 13
  }
};

export const EDITOR_LAYOUT_FLOATING_PRESETS: Readonly<Record<EditorFloatingPresetId, EditorFloatingPreset>> = {
  compactReview: {
    label: 'Compact review',
    floatingPanels: {
      ...EDITOR_LAYOUT_FLOATING_PANEL_DEFAULTS,
      inspector: { ...EDITOR_LAYOUT_FLOATING_PANEL_DEFAULTS.inspector, floating: true, x: 672, y: 64, zIndex: 20 }
    }
  },
  reviewDeck: {
    label: 'Review deck',
    floatingPanels: {
      ...EDITOR_LAYOUT_FLOATING_PANEL_DEFAULTS,
      program: { ...EDITOR_LAYOUT_FLOATING_PANEL_DEFAULTS.program, floating: true, x: 288, y: 56, zIndex: 20 },
      inspector: { ...EDITOR_LAYOUT_FLOATING_PANEL_DEFAULTS.inspector, floating: true, x: 760, y: 84, zIndex: 21 },
      export: { ...EDITOR_LAYOUT_FLOATING_PANEL_DEFAULTS.export, floating: true, x: 480, y: 424, zIndex: 22 }
    }
  }
};

export const EDITOR_LAYOUT_DEFAULT_PREFERENCE: EditorLayoutPreference = {
  schemaVersion: EDITOR_LAYOUT_SCHEMA_VERSION,
  leftDockVisible: true,
  inspectorVisible: true,
  inspectorPlacement: 'right',
  leftDockWidth: EDITOR_LAYOUT_DEFAULT_LEFT_DOCK_WIDTH,
  inspectorWidth: EDITOR_LAYOUT_DEFAULT_INSPECTOR_WIDTH,
  programPercent: 58,
  floatingPanels: EDITOR_LAYOUT_FLOATING_PANEL_DEFAULTS
};

export const EDITOR_PANEL_LAYOUT_DEFAULT: EditorPanelLayout = {
  schemaVersion: EDITOR_LAYOUT_SCHEMA_VERSION,
  leftDock: {
    visible: EDITOR_LAYOUT_DEFAULT_PREFERENCE.leftDockVisible,
    width: EDITOR_LAYOUT_DEFAULT_PREFERENCE.leftDockWidth
  },
  inspector: {
    visible: EDITOR_LAYOUT_DEFAULT_PREFERENCE.inspectorVisible,
    placement: EDITOR_LAYOUT_DEFAULT_PREFERENCE.inspectorPlacement,
    width: EDITOR_LAYOUT_DEFAULT_PREFERENCE.inspectorWidth
  },
  program: {
    percent: EDITOR_LAYOUT_DEFAULT_PREFERENCE.programPercent
  },
  floatingPanels: EDITOR_LAYOUT_FLOATING_PANEL_DEFAULTS
};

type PlainRecord = Record<string, unknown>;

function isRecord(value: unknown): value is PlainRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasAllowedKeys(value: PlainRecord, allowedKeys: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowedKeys.includes(key));
}

function isEditorInspectorPlacement(value: unknown): value is EditorInspectorPlacement {
  switch (value) {
    case 'left':
    case 'right':
    case 'floating':
      return true;
    default:
      return false;
  }
}

function isEditorFloatingPanelId(value: unknown): value is EditorFloatingPanelId {
  switch (value) {
    case 'project':
    case 'program':
    case 'inspector':
    case 'export':
      return true;
    default:
      return false;
  }
}

function getOptionalFiniteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)));
}

export function clampEditorProgramPercent(percent: number): number {
  return Math.min(EDITOR_LAYOUT_MAX_PROGRAM_PERCENT, Math.max(EDITOR_LAYOUT_MIN_PROGRAM_PERCENT, Math.round(percent)));
}

export function clampEditorLeftDockWidth(width: number): number {
  return Math.min(EDITOR_LAYOUT_MAX_LEFT_DOCK_WIDTH, Math.max(EDITOR_LAYOUT_MIN_LEFT_DOCK_WIDTH, Math.round(width)));
}

export function clampEditorInspectorWidth(width: number): number {
  return Math.min(EDITOR_LAYOUT_MAX_INSPECTOR_WIDTH, Math.max(EDITOR_LAYOUT_MIN_INSPECTOR_WIDTH, Math.round(width)));
}

function clampEditorFloatingPanel(panel: EditorFloatingPanel): EditorFloatingPanel {
  return {
    floating: panel.floating,
    height: clampNumber(panel.height, EDITOR_LAYOUT_FLOATING_PANEL_MIN_HEIGHT, EDITOR_LAYOUT_FLOATING_PANEL_MAX_HEIGHT),
    width: clampNumber(panel.width, EDITOR_LAYOUT_FLOATING_PANEL_MIN_WIDTH, EDITOR_LAYOUT_FLOATING_PANEL_MAX_WIDTH),
    x: clampNumber(panel.x, EDITOR_LAYOUT_FLOATING_PANEL_MIN_X, EDITOR_LAYOUT_FLOATING_PANEL_MAX_X),
    y: clampNumber(panel.y, EDITOR_LAYOUT_FLOATING_PANEL_MIN_Y, EDITOR_LAYOUT_FLOATING_PANEL_MAX_Y),
    zIndex: clampNumber(panel.zIndex, EDITOR_LAYOUT_FLOATING_PANEL_MIN_Z_INDEX, EDITOR_LAYOUT_FLOATING_PANEL_MAX_Z_INDEX)
  };
}

function parseEditorFloatingPanel(value: unknown, fallback: EditorFloatingPanel): EditorFloatingPanel | null {
  if (!isRecord(value)) return null;
  if (!hasAllowedKeys(value, ['floating', 'height', 'width', 'x', 'y', 'zIndex'])) return null;
  if (typeof value.floating !== 'boolean') return null;

  return clampEditorFloatingPanel({
    floating: value.floating,
    height: getOptionalFiniteNumber(value.height, fallback.height),
    width: getOptionalFiniteNumber(value.width, fallback.width),
    x: getOptionalFiniteNumber(value.x, fallback.x),
    y: getOptionalFiniteNumber(value.y, fallback.y),
    zIndex: getOptionalFiniteNumber(value.zIndex, fallback.zIndex)
  });
}

function parseEditorFloatingPanels(value: unknown): EditorFloatingPanels {
  if (!isRecord(value)) return EDITOR_LAYOUT_FLOATING_PANEL_DEFAULTS;
  if (!Object.keys(value).every(isEditorFloatingPanelId)) return EDITOR_LAYOUT_FLOATING_PANEL_DEFAULTS;

  return {
    project: parseEditorFloatingPanel(value.project, EDITOR_LAYOUT_FLOATING_PANEL_DEFAULTS.project) ?? EDITOR_LAYOUT_FLOATING_PANEL_DEFAULTS.project,
    program: parseEditorFloatingPanel(value.program, EDITOR_LAYOUT_FLOATING_PANEL_DEFAULTS.program) ?? EDITOR_LAYOUT_FLOATING_PANEL_DEFAULTS.program,
    inspector: parseEditorFloatingPanel(value.inspector, EDITOR_LAYOUT_FLOATING_PANEL_DEFAULTS.inspector) ?? EDITOR_LAYOUT_FLOATING_PANEL_DEFAULTS.inspector,
    export: parseEditorFloatingPanel(value.export, EDITOR_LAYOUT_FLOATING_PANEL_DEFAULTS.export) ?? EDITOR_LAYOUT_FLOATING_PANEL_DEFAULTS.export
  };
}

function parseEditorPanelV1Layout(parsedLayout: PlainRecord): EditorPanelLayout | null {
  if (!hasAllowedKeys(parsedLayout, ['schemaVersion', 'leftDockVisible', 'inspectorVisible', 'programPercent'])) return null;
  if (typeof parsedLayout.leftDockVisible !== 'boolean') return null;
  if (typeof parsedLayout.inspectorVisible !== 'boolean') return null;
  if (typeof parsedLayout.programPercent !== 'number' || !Number.isFinite(parsedLayout.programPercent)) return null;

  return {
    schemaVersion: EDITOR_LAYOUT_SCHEMA_VERSION,
    leftDock: {
      visible: parsedLayout.leftDockVisible,
      width: EDITOR_LAYOUT_DEFAULT_LEFT_DOCK_WIDTH
    },
    inspector: {
      visible: parsedLayout.inspectorVisible,
      placement: 'right',
      width: EDITOR_LAYOUT_DEFAULT_INSPECTOR_WIDTH
    },
    program: {
      percent: clampEditorProgramPercent(parsedLayout.programPercent)
    },
    floatingPanels: EDITOR_LAYOUT_FLOATING_PANEL_DEFAULTS
  };
}

function parseEditorPanelV2Layout(parsedLayout: PlainRecord): EditorPanelLayout | null {
  if (!hasAllowedKeys(parsedLayout, ['schemaVersion', 'leftDockVisible', 'inspectorVisible', 'inspectorPlacement', 'leftDockWidth', 'inspectorWidth', 'programPercent'])) return null;
  if (typeof parsedLayout.leftDockVisible !== 'boolean') return null;
  if (typeof parsedLayout.inspectorVisible !== 'boolean') return null;
  if (!isEditorInspectorPlacement(parsedLayout.inspectorPlacement)) return null;
  if (typeof parsedLayout.programPercent !== 'number' || !Number.isFinite(parsedLayout.programPercent)) return null;

  return {
    schemaVersion: EDITOR_LAYOUT_SCHEMA_VERSION,
    leftDock: {
      visible: parsedLayout.leftDockVisible,
      width: clampEditorLeftDockWidth(getOptionalFiniteNumber(parsedLayout.leftDockWidth, EDITOR_LAYOUT_DEFAULT_LEFT_DOCK_WIDTH))
    },
    inspector: {
      visible: parsedLayout.inspectorVisible,
      placement: parsedLayout.inspectorPlacement,
      width: clampEditorInspectorWidth(getOptionalFiniteNumber(parsedLayout.inspectorWidth, EDITOR_LAYOUT_DEFAULT_INSPECTOR_WIDTH))
    },
    program: {
      percent: clampEditorProgramPercent(parsedLayout.programPercent)
    },
    floatingPanels: EDITOR_LAYOUT_FLOATING_PANEL_DEFAULTS
  };
}

function parseEditorPanelV3Layout(parsedLayout: PlainRecord): EditorPanelLayout | null {
  if (!hasAllowedKeys(parsedLayout, ['schemaVersion', 'leftDock', 'inspector', 'program', 'floatingPanels'])) return null;
  if (!isRecord(parsedLayout.leftDock) || !isRecord(parsedLayout.inspector) || !isRecord(parsedLayout.program)) return null;
  if (typeof parsedLayout.leftDock.visible !== 'boolean') return null;
  if (typeof parsedLayout.inspector.visible !== 'boolean') return null;
  if (!isEditorInspectorPlacement(parsedLayout.inspector.placement)) return null;
  if (typeof parsedLayout.program.percent !== 'number' || !Number.isFinite(parsedLayout.program.percent)) return null;

  return {
    schemaVersion: EDITOR_LAYOUT_SCHEMA_VERSION,
    leftDock: {
      visible: parsedLayout.leftDock.visible,
      width: clampEditorLeftDockWidth(getOptionalFiniteNumber(parsedLayout.leftDock.width, EDITOR_LAYOUT_DEFAULT_LEFT_DOCK_WIDTH))
    },
    inspector: {
      visible: parsedLayout.inspector.visible,
      placement: parsedLayout.inspector.placement,
      width: clampEditorInspectorWidth(getOptionalFiniteNumber(parsedLayout.inspector.width, EDITOR_LAYOUT_DEFAULT_INSPECTOR_WIDTH))
    },
    program: {
      percent: clampEditorProgramPercent(parsedLayout.program.percent)
    },
    floatingPanels: parseEditorFloatingPanels(parsedLayout.floatingPanels)
  };
}

export function parseEditorPanelLayout(storedLayout: string | null | undefined): EditorPanelLayout {
  if (storedLayout === null || storedLayout === undefined) return EDITOR_PANEL_LAYOUT_DEFAULT;

  try {
    const parsedLayout: unknown = JSON.parse(storedLayout);
    if (!isRecord(parsedLayout)) return EDITOR_PANEL_LAYOUT_DEFAULT;

    switch (parsedLayout.schemaVersion) {
      case 1:
        return parseEditorPanelV1Layout(parsedLayout) ?? EDITOR_PANEL_LAYOUT_DEFAULT;
      case 2:
        return parseEditorPanelV2Layout(parsedLayout) ?? EDITOR_PANEL_LAYOUT_DEFAULT;
      case 3:
        return parseEditorPanelV3Layout(parsedLayout) ?? EDITOR_PANEL_LAYOUT_DEFAULT;
      default:
        return EDITOR_PANEL_LAYOUT_DEFAULT;
    }
  } catch (error) {
    if (error instanceof SyntaxError) return EDITOR_PANEL_LAYOUT_DEFAULT;
    throw error;
  }
}

export function flattenEditorPanelLayout(layout: EditorPanelLayout): EditorLayoutPreference {
  return {
    schemaVersion: EDITOR_LAYOUT_SCHEMA_VERSION,
    leftDockVisible: layout.leftDock.visible,
    inspectorVisible: layout.inspector.visible,
    inspectorPlacement: layout.inspector.placement,
    leftDockWidth: layout.leftDock.width,
    inspectorWidth: layout.inspector.width,
    programPercent: layout.program.percent,
    floatingPanels: layout.floatingPanels
  };
}

export function expandEditorLayoutPreference(preference: EditorLayoutPreference): EditorPanelLayout {
  return {
    schemaVersion: EDITOR_LAYOUT_SCHEMA_VERSION,
    leftDock: {
      visible: preference.leftDockVisible,
      width: preference.leftDockWidth
    },
    inspector: {
      visible: preference.inspectorVisible,
      placement: preference.inspectorPlacement,
      width: preference.inspectorWidth
    },
    program: {
      percent: preference.programPercent
    },
    floatingPanels: preference.floatingPanels
  };
}

export function setEditorFloatingPanelMode(preference: EditorLayoutPreference, panelId: EditorFloatingPanelId, floating: boolean): EditorLayoutPreference {
  const nextFloatingPanels = {
    ...preference.floatingPanels,
    [panelId]: {
      ...preference.floatingPanels[panelId],
      floating
    }
  };

  return panelId === 'inspector'
    ? { ...preference, floatingPanels: nextFloatingPanels, inspectorPlacement: floating ? 'floating' : preference.inspectorPlacement === 'floating' ? 'right' : preference.inspectorPlacement, inspectorVisible: true }
    : { ...preference, floatingPanels: nextFloatingPanels };
}

export function setEditorFloatingPanels(preference: EditorLayoutPreference, floatingPanels: EditorFloatingPanels): EditorLayoutPreference {
  return {
    ...preference,
    floatingPanels,
    inspectorPlacement: floatingPanels.inspector.floating ? 'floating' : preference.inspectorPlacement === 'floating' ? 'right' : preference.inspectorPlacement,
    inspectorVisible: floatingPanels.inspector.floating ? true : preference.inspectorVisible
  };
}

export function bringEditorFloatingPanelToFront(preference: EditorLayoutPreference, panelId: EditorFloatingPanelId): EditorLayoutPreference {
  const highestZIndex = Math.max(...EDITOR_FLOATING_PANEL_IDS.map((id) => preference.floatingPanels[id].zIndex));
  const nextZIndex = clampNumber(highestZIndex + 1, EDITOR_LAYOUT_FLOATING_PANEL_MIN_Z_INDEX, EDITOR_LAYOUT_FLOATING_PANEL_MAX_Z_INDEX);

  return {
    ...preference,
    floatingPanels: {
      ...preference.floatingPanels,
      [panelId]: {
        ...preference.floatingPanels[panelId],
        zIndex: nextZIndex
      }
    }
  };
}

export function moveEditorFloatingPanel(preference: EditorLayoutPreference, panelId: EditorFloatingPanelId, panel: EditorFloatingPanel): EditorLayoutPreference {
  return {
    ...preference,
    floatingPanels: {
      ...preference.floatingPanels,
      [panelId]: clampEditorFloatingPanel(panel)
    }
  };
}

export function getEditorFloatingPanelAfterKeyboardMove({ key, panel, shiftKey }: EditorFloatingPanelKeyboardMoveInput): EditorFloatingPanel | null {
  const step = shiftKey ? EDITOR_LAYOUT_SIDEBAR_SHIFT_STEP : EDITOR_LAYOUT_SIDEBAR_ARROW_STEP;

  switch (key) {
    case 'ArrowLeft':
      return clampEditorFloatingPanel({ ...panel, x: panel.x - step });
    case 'ArrowRight':
      return clampEditorFloatingPanel({ ...panel, x: panel.x + step });
    case 'ArrowUp':
      return clampEditorFloatingPanel({ ...panel, y: panel.y - step });
    case 'ArrowDown':
      return clampEditorFloatingPanel({ ...panel, y: panel.y + step });
    default:
      return null;
  }
}

export function serializeEditorPanelLayout(layout: EditorPanelLayout): string {
  return JSON.stringify(layout);
}
