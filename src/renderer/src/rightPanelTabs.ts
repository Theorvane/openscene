/**
 * The workspace side panel shows one of three surfaces, chosen by the tab strip
 * in its top bar: the Edit Agent chat, or the voice and video generation
 * studios. They share one panel — and one width, collapse state, and splitter —
 * rather than competing for edges of the screen.
 */
export const RIGHT_PANEL_TAB_IDS = ['chat', 'voice', 'video'] as const;

export type RightPanelTabId = (typeof RIGHT_PANEL_TAB_IDS)[number];

export const RIGHT_PANEL_TAB_STORAGE_KEY = 'openvideo-right-panel-tab';
export const RIGHT_PANEL_DEFAULT_TAB_ID: RightPanelTabId = 'chat';

export function isRightPanelTabId(value: unknown): value is RightPanelTabId {
  return typeof value === 'string' && (RIGHT_PANEL_TAB_IDS as readonly string[]).includes(value);
}

/** Anything unrecognised falls back to chat rather than an empty panel. */
export function parseRightPanelTabId(storedTabId: string | null | undefined): RightPanelTabId {
  return isRightPanelTabId(storedTabId) ? storedTabId : RIGHT_PANEL_DEFAULT_TAB_ID;
}
