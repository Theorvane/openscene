/** Navigation only: switching workspaces never starts a job or changes media. */
export const WORKSPACE_MODES = ['edit', 'create'] as const;
export type WorkspaceMode = (typeof WORKSPACE_MODES)[number];
/** Shared product entrances; both surfaces keep the same project and media. */
export const WORKSPACE_EXPERIENCES = {
  edit: {
    title: 'Video Editing',
    description: 'Shape existing footage into a finished cut.',
    tools: 'Timeline · Trim · Arrange · Export',
    entryTab: 'edit'
  },
  create: {
    title: 'AI Creation',
    description: 'Build new videos from a story, prompts and reference frames.',
    tools: 'Script · Images · Video · Voice',
    entryTab: 'video'
  }
} as const;
export const WORKSPACE_MODE_LABELS: Readonly<Record<WorkspaceMode, string>> = {
  edit: 'Video Editing',
  create: 'AI Creation'
};
export const CREATION_TOOLS = ['video', 'writer', 'image', 'voice'] as const;
export type CreationTool = (typeof CREATION_TOOLS)[number];

export function isCreationTool(value: unknown): value is CreationTool {
  return typeof value === 'string' && (CREATION_TOOLS as readonly string[]).includes(value);
}

export function workspaceModeForTab(tab: string, current: WorkspaceMode = 'edit'): WorkspaceMode {
  return tab === 'edit' ? 'edit' : isCreationTool(tab) ? 'create' : current;
}

export function workspaceTabForMode(mode: WorkspaceMode, lastCreationTool: CreationTool): 'edit' | CreationTool {
  return mode === 'edit' ? 'edit' : lastCreationTool;
}

export function isTabInWorkspace(tab: string, mode: WorkspaceMode): boolean {
  return tab === 'library' || tab === 'agent' || (mode === 'edit' ? tab === 'edit' : isCreationTool(tab));
}
