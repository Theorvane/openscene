import type { AppWorkspaceId } from './appWorkspaces';

export const APP_PAGE_IDS = ['home', 'projects', 'edit', 'voice-generation', 'video-generation', 'settings'] as const;
export type AppPageId = (typeof APP_PAGE_IDS)[number];

export type AppPage = {
  readonly id: AppPageId;
  readonly label: string;
  readonly chromeLabel: string;
  readonly panelId: string;
};

export type WorkspacePageId = Extract<AppPageId, AppWorkspaceId>;

export const APP_PAGES = [
  {
    id: 'home',
    label: 'Home',
    chromeLabel: 'Home',
    panelId: 'app-page-panel-home'
  },
  {
    id: 'projects',
    label: 'Projects',
    chromeLabel: 'Projects',
    panelId: 'app-page-panel-projects'
  },
  {
    id: 'edit',
    label: 'Editing',
    chromeLabel: 'Editing',
    panelId: 'app-workspace-panel-edit'
  },
  {
    id: 'voice-generation',
    label: 'Voice Generation',
    chromeLabel: 'Voice Generation',
    panelId: 'app-workspace-panel-voice-generation'
  },
  {
    id: 'video-generation',
    label: 'Video Generation',
    chromeLabel: 'Video Generation',
    panelId: 'app-workspace-panel-video-generation'
  },
  {
    id: 'settings',
    label: 'Settings',
    chromeLabel: 'Settings',
    panelId: 'app-page-panel-settings'
  }
] as const satisfies readonly AppPage[];

export const APP_PAGE_BY_ID = {
  home: APP_PAGES[0],
  projects: APP_PAGES[1],
  edit: APP_PAGES[2],
  'voice-generation': APP_PAGES[3],
  'video-generation': APP_PAGES[4],
  settings: APP_PAGES[5]
} as const satisfies Readonly<Record<AppPageId, AppPage>>;

export function getDefaultAppPageId(): AppPageId {
  return 'projects';
}

export function isWorkspacePageId(pageId: AppPageId): pageId is WorkspacePageId {
  switch (pageId) {
    case 'edit':
    case 'voice-generation':
    case 'video-generation':
      return true;
    case 'home':
    case 'projects':
    case 'settings':
      return false;
    default:
      return assertNever(pageId);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unexpected app page id: ${String(value)}`);
}
