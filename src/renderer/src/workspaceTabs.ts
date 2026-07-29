/**
 * The workspace area shows one of three surfaces, chosen by the tab strip in
 * its top-left corner: the timeline editor, or the voice and video generation
 * studios. They are tabs rather than pages so producing a clip and placing it
 * on the timeline never leaves the workspace, and the Edit Agent chat stays
 * open beside all three.
 */
export const WORKSPACE_TAB_IDS = ['edit', 'voice', 'video'] as const;

export type WorkspaceTabId = (typeof WORKSPACE_TAB_IDS)[number];

export const WORKSPACE_TAB_STORAGE_KEY = 'openvideo-workspace-tab';
export const WORKSPACE_DEFAULT_TAB_ID: WorkspaceTabId = 'edit';

export const WORKSPACE_TAB_LABELS: Readonly<Record<WorkspaceTabId, string>> = {
  edit: 'Editing',
  voice: 'Voice Generation',
  video: 'Video Generation'
};

export function isWorkspaceTabId(value: unknown): value is WorkspaceTabId {
  return typeof value === 'string' && (WORKSPACE_TAB_IDS as readonly string[]).includes(value);
}

/** Anything unrecognised falls back to the editor rather than a blank area. */
export function parseWorkspaceTabId(storedTabId: string | null | undefined): WorkspaceTabId {
  return isWorkspaceTabId(storedTabId) ? storedTabId : WORKSPACE_DEFAULT_TAB_ID;
}
