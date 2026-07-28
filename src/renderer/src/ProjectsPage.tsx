import type { ReactElement } from 'react';

import type { LocalProjectSnapshot, LocalProjectSummary } from '../../shared/timelineTypes';
import { formatTimestamp } from './format';
import { Button } from './ui';

type ProjectsPageProps = {
  readonly project?: LocalProjectSnapshot | null;
  readonly projects?: readonly LocalProjectSummary[];
  readonly newProjectName?: string;
  readonly onNewProjectNameChange?: (name: string) => void;
  readonly onCreateProject?: () => Promise<void>;
  readonly onOpenProject?: (projectId: string) => Promise<void>;
  readonly isBusy?: boolean;
};

export function ProjectsPage({
  project = null,
  projects = [],
  newProjectName = '',
  onNewProjectNameChange,
  onCreateProject,
  onOpenProject,
  isBusy = false
}: ProjectsPageProps): ReactElement {
  return (
    <div className="projects-page">
      <header className="projects-page__hero">
        <p className="section-kicker">Stage 1 / 3 · Project Selection</p>
        <h1 id="projects-page-title">Local Project Folders</h1>
        <p>
          OpenVideo stores every project in a dedicated local folder. Create a new project folder or select an existing folder below to unlock the studio menu and workspaces.
        </p>
      </header>

      {/* Active Project Banner if open */}
      {project !== null && (
        <div className="home-active-project-banner" role="status">
          <div className="home-active-project-banner__info">
            <span className="home-active-project-banner__kicker">● Active Project Folder</span>
            <strong className="home-active-project-banner__name">{project.name}</strong>
          </div>
          <Button variant="primary" onClick={() => void onOpenProject?.(project.id)}>
            Proceed to Main Menu ➔
          </Button>
        </div>
      )}

      {/* Folder-Based Project Creation & Selection Hub */}
      <section className="home-project-hub" aria-label="Project folder management hub">
        <div className="home-project-hub__creator">
          <div className="home-project-hub__header">
            <span className="home-project-hub__kicker">📁 Folder-Based Setup</span>
            <h2 className="home-project-hub__title">Create New Project Folder</h2>
          </div>
          <div className="home-project-hub__form">
            <label className="field-label" htmlFor="projects-name-input">
              Project Folder Name
              <input
                id="projects-name-input"
                type="text"
                value={newProjectName}
                onChange={(e) => onNewProjectNameChange?.(e.target.value)}
                placeholder="My New Video Project"
                disabled={isBusy}
              />
            </label>
            <Button
              variant="primary"
              onClick={() => void onCreateProject?.()}
              disabled={isBusy || newProjectName.trim().length === 0}
            >
              Create Project Folder ➔
            </Button>
          </div>
        </div>

        {projects.length > 0 && (
          <div className="home-project-hub__list-section">
            <span className="home-project-hub__kicker">📁 Saved Local Projects ({projects.length})</span>
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
                        <strong className="home-project-item__name">📁 {item.name}</strong>
                        {isSelected && <span className="home-project-item__badge">● Active</span>}
                      </div>
                      <span className="home-project-item__date">Updated: {formatTimestamp(item.updatedAt)}</span>
                    </div>
                    <Button
                      variant={isSelected ? 'primary' : 'ghost'}
                      onClick={() => void onOpenProject?.(item.id)}
                      disabled={isBusy}
                    >
                      {isSelected ? 'Open Menu ➔' : 'Select Project'}
                    </Button>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
