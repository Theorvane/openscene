/**
 * Layout for the Studio side panel — the voice and video generation surface
 * that sits opposite the Edit Agent chat. It mirrors the chat panel's own
 * preference model (persisted width, persisted collapsed state, keyboard
 * resize) but keeps its own storage key and its own arrow-key direction,
 * because it is docked on the leading edge rather than the trailing one.
 */
export const STUDIO_PANEL_STORAGE_KEY = 'openvideo-studio-panel-layout';
export const STUDIO_PANEL_SCHEMA_VERSION = 1;
export const STUDIO_PANEL_MIN_WIDTH = 300;
export const STUDIO_PANEL_MAX_WIDTH = 520;
export const STUDIO_PANEL_DEFAULT_WIDTH = 360;
export const STUDIO_PANEL_MIN_WORKSPACE_WIDTH = 620;

const STUDIO_PANEL_ARROW_STEP = 16;
const STUDIO_PANEL_SHIFT_STEP = 48;

export type StudioPanelTabId = 'voice' | 'video';

export type StudioPanelPreference = {
  readonly schemaVersion: typeof STUDIO_PANEL_SCHEMA_VERSION;
  readonly width: number;
  /** Collapsed by default: the editor owns the screen until it is opened. */
  readonly collapsed: boolean;
  readonly tabId: StudioPanelTabId;
};

export type StudioPanelResizeKeyInput = {
  readonly currentWidth: number;
  readonly key: string;
  readonly shiftKey: boolean;
};

export const STUDIO_PANEL_DEFAULT_PREFERENCE: StudioPanelPreference = {
  schemaVersion: STUDIO_PANEL_SCHEMA_VERSION,
  width: STUDIO_PANEL_DEFAULT_WIDTH,
  collapsed: true,
  tabId: 'voice'
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStudioPanelTabId(value: unknown): value is StudioPanelTabId {
  return value === 'voice' || value === 'video';
}

export function clampStudioPanelWidth(width: number, containerWidth?: number): number {
  const roundedWidth = Math.round(width);
  const widthPreservingWorkspace =
    containerWidth === undefined || containerWidth < STUDIO_PANEL_MIN_WORKSPACE_WIDTH + STUDIO_PANEL_MIN_WIDTH
      ? roundedWidth
      : Math.min(roundedWidth, containerWidth - STUDIO_PANEL_MIN_WORKSPACE_WIDTH);

  return Math.min(STUDIO_PANEL_MAX_WIDTH, Math.max(STUDIO_PANEL_MIN_WIDTH, widthPreservingWorkspace));
}

export function parseStudioPanelPreference(storedPreference: string | null | undefined): StudioPanelPreference {
  if (storedPreference === null || storedPreference === undefined) return STUDIO_PANEL_DEFAULT_PREFERENCE;

  try {
    const parsed: unknown = JSON.parse(storedPreference);
    if (!isRecord(parsed)) return STUDIO_PANEL_DEFAULT_PREFERENCE;
    if (parsed.schemaVersion !== STUDIO_PANEL_SCHEMA_VERSION) return STUDIO_PANEL_DEFAULT_PREFERENCE;
    if (typeof parsed.width !== 'number' || !Number.isFinite(parsed.width)) return STUDIO_PANEL_DEFAULT_PREFERENCE;

    return {
      schemaVersion: STUDIO_PANEL_SCHEMA_VERSION,
      width: clampStudioPanelWidth(parsed.width),
      collapsed: parsed.collapsed !== false,
      tabId: isStudioPanelTabId(parsed.tabId) ? parsed.tabId : STUDIO_PANEL_DEFAULT_PREFERENCE.tabId
    };
  } catch (error) {
    if (error instanceof SyntaxError) return STUDIO_PANEL_DEFAULT_PREFERENCE;
    throw error;
  }
}

export function serializeStudioPanelPreference(preference: StudioPanelPreference): string {
  return JSON.stringify({
    schemaVersion: STUDIO_PANEL_SCHEMA_VERSION,
    width: clampStudioPanelWidth(preference.width),
    collapsed: preference.collapsed === true,
    tabId: preference.tabId
  });
}

export function getNextStudioPanelWidthFromKey({ currentWidth, key, shiftKey }: StudioPanelResizeKeyInput): number | null {
  const step = shiftKey ? STUDIO_PANEL_SHIFT_STEP : STUDIO_PANEL_ARROW_STEP;

  switch (key) {
    // Docked on the leading edge, so ArrowRight grows it — the mirror of the
    // trailing-edge chat panel.
    case 'ArrowRight':
      return clampStudioPanelWidth(currentWidth + step);
    case 'ArrowLeft':
      return clampStudioPanelWidth(currentWidth - step);
    case 'Home':
      return STUDIO_PANEL_MIN_WIDTH;
    case 'End':
      return STUDIO_PANEL_MAX_WIDTH;
    case 'Enter':
      return STUDIO_PANEL_DEFAULT_WIDTH;
    default:
      return null;
  }
}
