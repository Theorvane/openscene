import type { ReactElement } from 'react';

import type { LocalProjectSnapshot } from '../../shared/timelineTypes';
import type { AppWorkspace, AppWorkspaceId } from './appWorkspaces';
import { Button } from './ui';

type HomePageProps = {
  readonly onWorkspaceOpen: (workspaceId: AppWorkspaceId) => void;
  readonly workspaces: readonly AppWorkspace[];
  readonly project?: LocalProjectSnapshot | null;
  readonly onGoToProjects?: () => void;
};

const WORKSPACE_COPY = {
  edit: {
    heading: 'Editing (영상 편집)',
    description: 'Open the timeline editor, manage media bin assets, cut clips, and export MP4 output with local FFmpeg.',
    action: 'Enter Timeline Editor ➔'
  }
} as const satisfies Readonly<Record<AppWorkspaceId, { readonly heading: string; readonly description: string; readonly action: string }>>;

function CardIcon({ workspaceId }: { readonly workspaceId: AppWorkspaceId }): ReactElement {
  switch (workspaceId) {
    case 'edit':
      return (
        <svg className="home-card__icon-svg" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M4.5 7.5h15" />
          <path d="M4.5 12h15" />
          <path d="M4.5 16.5h15" />
          <path d="M8.5 5.5v13" />
          <path d="M13.5 9.75h3.75" />
          <path d="M6.75 14.25h5.25" />
        </svg>
      );
    default:
      return assertNever(workspaceId);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unexpected home workspace id: ${String(value)}`);
}

export function HomePage({
  onWorkspaceOpen,
  workspaces,
  project = null,
  onGoToProjects
}: HomePageProps): ReactElement {
  return (
    <div className="home-page">
      <header className="home-page__hero">
        <p className="section-kicker">Main Menu</p>
        <h1 id="home-page-title">Select Studio Workspace</h1>
        <p>
          Open the editor for your active project folder. Voice and video generation live in the editor's left dock, alongside the media bin.
        </p>
      </header>

      {/* Active Project Banner */}
      {project !== null ? (
        <div className="home-active-project-banner" role="status">
          <div className="home-active-project-banner__info">
            <span className="home-active-project-banner__kicker">● Active Project Folder</span>
            <strong className="home-active-project-banner__name">{project.name}</strong>
          </div>
          <Button variant="ghost" onClick={onGoToProjects}>
            Change Project Folder
          </Button>
        </div>
      ) : (
        <div className="home-active-project-banner home-active-project-banner--empty" role="status">
          <div className="home-active-project-banner__info">
            <span className="home-active-project-banner__kicker">● Project Required</span>
            <strong className="home-active-project-banner__name">No Project Folder Selected</strong>
          </div>
          <Button variant="primary" onClick={onGoToProjects}>
            Go to Projects Page ➔
          </Button>
        </div>
      )}

      {/* Studio Workspace Cards */}
      <div className="home-card-grid" aria-label="OpenVideo workspaces">
        {workspaces.map((workspace) => {
          const card = WORKSPACE_COPY[workspace.id];
          return (
            <Button
              aria-controls={workspace.panelId}
              className="home-card"
              key={workspace.id}
              onClick={() => onWorkspaceOpen(workspace.id)}
            >
              <span className="home-card__icon" aria-hidden="true">
                <CardIcon workspaceId={workspace.id} />
              </span>
              <span className="home-card__body">
                <span className="home-card__kicker">{workspace.statusLabel}</span>
                <span className="home-card__title">{card.heading}</span>
                <span className="home-card__description">{card.description}</span>
                <span className="home-card__action">{card.action}</span>
              </span>
            </Button>
          );
        })}
      </div>
    </div>
  );
}
