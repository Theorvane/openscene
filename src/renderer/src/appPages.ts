import type { AppWorkspaceId } from './appWorkspaces';

export const APP_PAGE_IDS = ['projects', 'edit', 'settings'] as const;
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
    id: 'settings',
    label: 'Settings',
    chromeLabel: 'Settings',
    panelId: 'app-page-panel-settings'
  }
] as const satisfies readonly AppPage[];

export const APP_PAGE_BY_ID = {
  projects: APP_PAGES[0],
  edit: APP_PAGES[1],
  settings: APP_PAGES[2]
} as const satisfies Readonly<Record<AppPageId, AppPage>>;

export function getDefaultAppPageId(): AppPageId {
  return 'projects';
}

export function isWorkspacePageId(pageId: AppPageId): pageId is WorkspacePageId {
  switch (pageId) {
    case 'edit':
      return true;
    case 'projects':
    case 'settings':
      return false;
    default:
      return assertNever(pageId);
  }
}

/**
 * Stage flow: Projects → the editing workspace, whose tabs cover editing and
 * generation. The workspace operates on the active project, so it is
 * unreachable until one is open; Projects and Settings stay reachable always.
 */
export function isProjectRequiredPageId(pageId: AppPageId): boolean {
  switch (pageId) {
    case 'edit':
      return true;
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
