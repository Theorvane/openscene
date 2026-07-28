import type { ReactElement } from 'react';

import type { LocalProjectSnapshot, LocalProjectSummary } from '../../shared/timelineTypes';
import type { AppWorkspace, AppWorkspaceId } from './appWorkspaces';
import { formatTimestamp } from './format';
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
  readonly isBusy?: boolean;
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

export function HomePage({
  onWorkspaceOpen,
  workspaces,
  project = null,
  projects = [],
  newProjectName = '',
  onNewProjectNameChange,
  onCreateProject,
  onOpenProject,
  isBusy = false
}: HomePageProps): ReactElement {
  return (
    <div className="home-page">
      <header className="home-page__hero">
        <p className="section-kicker">Local studio home</p>
        <h1 id="home-page-title">Start with a project.</h1>
        <p>
          Create or select a local project first. All editing, voice synthesis, video jobs, and Edit Agent operations center around your project.
        </p>
      </header>

      {/* Project Creation & Selection Hub */}
      <section className="home-project-hub" aria-label="Project management hub">
        <div className="home-project-hub__creator">
          <div className="home-project-hub__header">
            <span className="home-project-hub__kicker">New Project</span>
            <h2 className="home-project-hub__title">Create Project</h2>
          </div>
          <div className="home-project-hub__form">
            <label className="field-label" htmlFor="home-project-name-input">
              Project Name
              <input
                id="home-project-name-input"
                type="text"
                value={newProjectName}
                onChange={(e) => onNewProjectNameChange?.(e.target.value)}
                placeholder="My New Video Cut"
                disabled={isBusy}
              />
            </label>
            <Button
              variant="primary"
              onClick={() => void onCreateProject?.()}
              disabled={isBusy || newProjectName.trim().length === 0}
            >
              Create Project
            </Button>
          </div>
        </div>

        {projects.length > 0 && (
          <div className="home-project-hub__list-section">
            <span className="home-project-hub__kicker">Recent Projects ({projects.length})</span>
            <div className="home-project-hub__grid">
              {projects.map((item) => {
                const isSelected = project?.id === item.id;
                return (
                  <div
                    key={item.id}
                    className={`home-project-item${isSelected ? ' home-project-item--active' : ''}`}
                  >
                    <div className="home-project-item__body">
                      <div className="home-project-item__header">
                        <strong className="home-project-item__name">{item.name}</strong>
                        {isSelected && <span className="home-project-item__badge">Active</span>}
                      </div>
                      <span className="home-project-item__date">{formatTimestamp(item.updatedAt)}</span>
                    </div>
                    <Button
                      variant={isSelected ? 'primary' : 'ghost'}
                      onClick={() => void onOpenProject?.(item.id)}
                      disabled={isBusy}
                    >
                      {isSelected ? 'Open Editor' : 'Select'}
                    </Button>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </section>

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
