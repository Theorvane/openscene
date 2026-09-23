/**
 * Stable surface identifiers retained beneath the two workspace modes.
 * Existing preferences must still open the same tool. Visible creation-tool
 * order and mode membership live in shared/workspaceModes for both surfaces.
 */
export const WORKSPACE_TAB_IDS = ['edit', 'writer', 'voice', 'video', 'image'] as const;

export type WorkspaceTabId = (typeof WORKSPACE_TAB_IDS)[number];

export const WORKSPACE_TAB_STORAGE_KEY = 'openvideo-workspace-tab';
export const WORKSPACE_DEFAULT_TAB_ID: WorkspaceTabId = 'edit';

export const WORKSPACE_TAB_LABELS: Readonly<Record<WorkspaceTabId, string>> = {
  edit: 'Editing',
  writer: 'Writer',
  voice: 'Voice Generation',
  video: 'Video Generation',
  image: 'Image Generation'
};

export function isWorkspaceTabId(value: unknown): value is WorkspaceTabId {
  return typeof value === 'string' && (WORKSPACE_TAB_IDS as readonly string[]).includes(value);
}

/** Anything unrecognised falls back to the editor rather than a blank area. */
export function parseWorkspaceTabId(storedTabId: string | null | undefined): WorkspaceTabId {
  return isWorkspaceTabId(storedTabId) ? storedTabId : WORKSPACE_DEFAULT_TAB_ID;
}
