export const APP_WORKSPACE_IDS = ['edit', 'voice-generation', 'video-generation'] as const;
const APP_WORKSPACE_FIRST_ID: AppWorkspaceId = 'edit';

export type AppWorkspaceId = (typeof APP_WORKSPACE_IDS)[number];

export type AppWorkspace = {
  readonly id: AppWorkspaceId;
  readonly label: string;
  readonly navId: string;
  readonly panelId: string;
  readonly statusLabel: string;
};

export const APP_WORKSPACES = [
  {
    id: 'edit',
    label: 'Editing',
    navId: 'app-workspace-nav-edit',
    panelId: 'app-workspace-panel-edit',
    statusLabel: 'Local timeline'
  },
  {
    id: 'voice-generation',
    label: 'Voice Generation',
    navId: 'app-workspace-nav-voice-generation',
    panelId: 'app-workspace-panel-voice-generation',
    statusLabel: 'Local narration'
  },
  {
    id: 'video-generation',
    label: 'Video Generation',
    navId: 'app-workspace-nav-video-generation',
    panelId: 'app-workspace-panel-video-generation',
    statusLabel: 'Result studio'
  }
] as const satisfies readonly AppWorkspace[];

export function getDefaultAppWorkspaceId(): AppWorkspaceId {
  return APP_WORKSPACE_FIRST_ID;
}
