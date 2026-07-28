import type { ReactElement } from 'react';

import type { LocalProjectSnapshot, LocalProjectSummary } from '../../shared/timelineTypes';
import { formatTimestamp } from './format';
import { Button } from './ui';

type ProjectsPageProps = {
  readonly project?: LocalProjectSnapshot | null;
  readonly projects?: readonly LocalProjectSummary[];
  readonly onOpenProject?: (projectId: string) => Promise<void>;
  readonly onOpenProjectFolder?: () => Promise<void>;
  readonly isBusy?: boolean;
};

function FolderPlusIcon(): ReactElement {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M3.5 6.25c0-.97.78-1.75 1.75-1.75h3.9c.47 0 .92.19 1.25.52l1.06 1.06c.33.33.78.52 1.25.52h6.04c.97 0 1.75.78 1.75 1.75v9.4c0 .97-.78 1.75-1.75 1.75H5.25c-.97 0-1.75-.78-1.75-1.75z" />
      <path d="M12 10.75v4.5" />
      <path d="M9.75 13h4.5" />
    </svg>
  );
}

export function ProjectsPage({
  project = null,
  projects = [],
  onOpenProject,
  onOpenProjectFolder,
  isBusy = false
}: ProjectsPageProps): ReactElement {
  return (
    <div className="projects-page">
      <header className="projects-page__hero">
        <p className="section-kicker">Projects</p>
        <h1 id="projects-page-title">Local Project Folders</h1>
        <p>
          OpenVideo stores every project in a dedicated local folder. Pick a folder below to unlock the studio menu and workspaces.
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
          <div className="home-project-hub__form">
            <Button
              variant="primary"
              className="home-project-hub__folder-picker"
              aria-label="Choose or create a project folder"
              title="Choose or create a project folder"
              onClick={() => void onOpenProjectFolder?.()}
              disabled={isBusy}
            >
              <FolderPlusIcon />
            </Button>
            <div className="home-project-hub__header">
              <h2 className="home-project-hub__title">Project Folder</h2>
              <p className="home-project-hub__hint">
                Pick a folder: an OpenVideo project inside opens, and an empty folder becomes a new project named after it. Use “New Folder” in the picker to start fresh.
              </p>
            </div>
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
                      <span className="home-project-item__date">
                        Updated: {formatTimestamp(item.updatedAt)}
                        {item.storage === 'external' && item.folderName ? ` · 📂 ${item.folderName}` : ''}
                      </span>
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
