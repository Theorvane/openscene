import type { ReactElement } from 'react';

import type { LocalProjectSnapshot, LocalProjectSummary } from '../../shared/timelineTypes';
import type { AppWorkspace, AppWorkspaceId } from './appWorkspaces';
import { Button } from './ui';

type HomePageProps = {
  readonly onWorkspaceOpen: (workspaceId: AppWorkspaceId) => void;
  readonly workspaces: readonly AppWorkspace[];
  readonly project?: LocalProjectSnapshot | null;
  readonly projects?: readonly LocalProjectSummary[];
  readonly newProjectName?: string;
  readonly onNewProjectNameChange?: (name: string) => void;
  readonly onCreateProject?: () => Promise<void>;
  readonly onOpenProject?: (projectId: string) => Promise<void>;
  readonly onGoToProjects?: () => void;
  readonly isBusy?: boolean;
};

const WORKSPACE_COPY = {
  edit: {
    heading: 'Editing (영상 편집)',
    description: 'Open the timeline editor, manage media bin assets, cut clips, and export MP4 output with local FFmpeg.',
    action: 'Enter Timeline Editor ➔'
  },
  'voice-generation': {
    heading: 'Voice Generation (음성 합성)',
    description: 'Synthesize voice narration scripts, configure local Qwen TTS or cloud engines, and import voice tracks into your timeline.',
    action: 'Enter Voice Studio ➔'
  },
  'video-generation': {
    heading: 'Video Generation (비디오 생성)',
    description: 'Generate video clips from AI prompt engines, monitor job completion, and add generated videos directly to project assets.',
    action: 'Enter Video Studio ➔'
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
    case 'voice-generation':
      return (
        <svg className="home-card__icon-svg" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M4.5 13.25v-2.5" />
          <path d="M8.25 16.5v-9" />
          <path d="M12 18.25V5.75" />
          <path d="M15.75 16.5v-9" />
          <path d="M19.5 13.25v-2.5" />
        </svg>
      );
    case 'video-generation':
      return (
        <svg className="home-card__icon-svg" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14" />
          <path d="M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
          <path d="M7 10l1.5 3L10 10" />
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
          Choose a studio tool below for your active project folder. Entering a workspace opens the full toolset and activates the Edit Agent chat assistant.
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
                <span className="home-card__kicker">STAGE 3 · {workspace.statusLabel}</span>
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
