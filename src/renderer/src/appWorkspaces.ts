export const APP_WORKSPACE_IDS = ['edit', 'voice-generation', 'video-generation'] as const;
const APP_WORKSPACE_FIRST_ID: AppWorkspaceId = 'edit';
const APP_WORKSPACE_LAST_ID: AppWorkspaceId = 'video-generation';
const APP_WORKSPACE_NEXT_IDS: Record<AppWorkspaceId, AppWorkspaceId> = {
  edit: 'voice-generation',
  'voice-generation': 'video-generation',
  'video-generation': 'edit'
};
const APP_WORKSPACE_PREVIOUS_IDS: Record<AppWorkspaceId, AppWorkspaceId> = {
  edit: 'video-generation',
  'voice-generation': 'edit',
  'video-generation': 'voice-generation'
};

export type AppWorkspaceId = (typeof APP_WORKSPACE_IDS)[number];

export type AppWorkspaceNavigationKey = 'ArrowUp' | 'ArrowDown' | 'Home' | 'End';

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

type AppWorkspaceNavigationInput = {
  readonly currentWorkspaceId: AppWorkspaceId;
  readonly key: AppWorkspaceNavigationKey;
};

function assertNever(value: never): never {
  throw new Error(`Unexpected workspace navigation key: ${String(value)}`);
}

export function getDefaultAppWorkspaceId(): AppWorkspaceId {
  return APP_WORKSPACE_FIRST_ID;
}

export function getNextAppWorkspaceId({ currentWorkspaceId, key }: AppWorkspaceNavigationInput): AppWorkspaceId {
  switch (key) {
    case 'ArrowDown':
      return APP_WORKSPACE_NEXT_IDS[currentWorkspaceId];
    case 'ArrowUp':
      return APP_WORKSPACE_PREVIOUS_IDS[currentWorkspaceId];
    case 'Home':
      return APP_WORKSPACE_FIRST_ID;
    case 'End':
      return APP_WORKSPACE_LAST_ID;
    default:
      return assertNever(key);
  }
}
