import type { ReactElement } from 'react';

import type { AppWorkspace, AppWorkspaceId } from './appWorkspaces';
import { Button } from './ui';

type HomePageProps = {
  readonly onWorkspaceOpen: (workspaceId: AppWorkspaceId) => void;
  readonly workspaces: readonly AppWorkspace[];
};

const WORKSPACE_COPY = {
  edit: {
    heading: 'Editing',
    description: 'Open the mounted timeline editor, review local media, and export a saved MP4 with your local FFmpeg setup.',
    action: 'Open editor'
  },
  'voice-generation': {
    heading: 'Voice Generation',
    description: 'Create consent-based narration through your configured local voice workflow and import the result into a project.',
    action: 'Open voice tools'
  },
  'video-generation': {
    heading: 'Video Generation',
    description: 'Manage generated video jobs through configured provider seams, then bring local results into the active project.',
    action: 'Open video tools'
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

export function HomePage({ onWorkspaceOpen, workspaces }: HomePageProps): ReactElement {
  return (
    <div className="home-page">
      <header className="home-page__hero">
        <p className="section-kicker">Local studio home</p>
        <h1 id="home-page-title">Start with the local tool you need.</h1>
        <p>
          OpenVideo keeps editing, consent-based narration, generated result management, and the Edit Agent in one local-first desktop shell.
        </p>
      </header>
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
