export const APP_WORKSPACE_IDS = ['prompt-studio', 'edit', 'video-generation', 'voice-generation', 'settings'] as const;
const APP_WORKSPACE_FIRST_ID: AppWorkspaceId = 'prompt-studio';
const APP_WORKSPACE_LAST_ID: AppWorkspaceId = 'settings';
const APP_WORKSPACE_NEXT_IDS: Record<AppWorkspaceId, AppWorkspaceId> = {
  'prompt-studio': 'edit',
  edit: 'video-generation',
  'video-generation': 'voice-generation',
  'voice-generation': 'settings',
  settings: 'prompt-studio'
};
const APP_WORKSPACE_PREVIOUS_IDS: Record<AppWorkspaceId, AppWorkspaceId> = {
  'prompt-studio': 'settings',
  edit: 'prompt-studio',
  'video-generation': 'edit',
  'voice-generation': 'video-generation',
  settings: 'voice-generation'
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
    id: 'prompt-studio',
    label: 'Prompt Studio',
    navId: 'app-workspace-nav-prompt-studio',
    panelId: 'app-workspace-panel-prompt-studio',
    statusLabel: 'Prompt to video'
  },
  {
    id: 'edit',
    label: 'Edit Timeline',
    navId: 'app-workspace-nav-edit',
    panelId: 'app-workspace-panel-edit',
    statusLabel: 'Local NLE'
  },
  {
    id: 'video-generation',
    label: 'AI Video Studio',
    navId: 'app-workspace-nav-video-generation',
    panelId: 'app-workspace-panel-video-generation',
    statusLabel: 'Local & API'
  },
  {
    id: 'voice-generation',
    label: 'AI Voice Studio',
    navId: 'app-workspace-nav-voice-generation',
    panelId: 'app-workspace-panel-voice-generation',
    statusLabel: 'Local & API'
  },
  {
    id: 'settings',
    label: 'Settings',
    navId: 'app-workspace-nav-settings',
    panelId: 'app-workspace-panel-settings',
    statusLabel: 'Preferences'
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
