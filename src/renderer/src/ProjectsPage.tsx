import type { ReactElement } from 'react';

import type { AgentChatHistoryEntry } from '../../shared/agentChat';
import type { LocalProjectSnapshot, LocalProjectSummary } from '../../shared/timelineTypes';
import { formatAgentChatTime, groupAgentChatHistory } from './agentChatHistoryView';
import { formatTimestamp } from './format';
import { Button } from './ui';

type ProjectsPageProps = {
  readonly project?: LocalProjectSnapshot | null;
  readonly projects?: readonly LocalProjectSummary[];
  readonly chats?: readonly AgentChatHistoryEntry[];
  readonly onOpenProject?: (projectId: string) => Promise<void>;
  readonly onOpenProjectFolder?: () => Promise<void>;
  readonly onOpenChat?: (entry: AgentChatHistoryEntry) => Promise<void>;
  readonly errorText?: string | undefined;
  readonly isBusy?: boolean;
};

function FolderPlusIcon(): ReactElement {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M3.5 6.25c0-.97.78-1.75 1.75-1.75h3.9c.47 0 .92.19 1.25.52l1.06 1.06c.33.33.78.52 1.25.52h6.04c.97 0 1.75.78 1.75 1.75v9.4c0 .97-.78 1.75-1.75 1.75H5.25c-.97 0-1.75-.78-1.75-1.75z" />
      <path d="M12 10.75v4.5" />
      <path d="M9.75 13h4.5" />
    </svg>
  );
}

function FolderGlyph(): ReactElement {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M3.5 6.25c0-.97.78-1.75 1.75-1.75h3.9c.47 0 .92.19 1.25.52l1.06 1.06c.33.33.78.52 1.25.52h6.04c.97 0 1.75.78 1.75 1.75v9.4c0 .97-.78 1.75-1.75 1.75H5.25c-.97 0-1.75-.78-1.75-1.75z" />
    </svg>
  );
}

export function ProjectsPage({
  project = null,
  projects = [],
  chats = [],
  onOpenProject,
  onOpenProjectFolder,
  onOpenChat,
  errorText,
  isBusy = false
}: ProjectsPageProps): ReactElement {
  const chatGroups = groupAgentChatHistory(chats, new Date());

  return (
    <div className="projects-home">
      <aside className="projects-home__sidebar" aria-label="Project folders">
        <div className="projects-home__heading-row">
          <h1 id="projects-page-title" className="projects-home__heading">Projects</h1>
          <Button
            variant="ghost"
            className="projects-home__add-button"
            aria-label="Choose or create a project folder"
            title="Choose or create a project folder"
            onClick={() => void onOpenProjectFolder?.()}
            disabled={isBusy}
          >
            <FolderPlusIcon />
          </Button>
        </div>
        {errorText !== undefined && errorText.length > 0 && (
          <p role="alert" className="projects-home__error">{errorText}</p>
        )}
        {projects.length > 0 ? (
          <ul className="projects-home__list">
            {projects.map((item) => {
              const isSelected = project?.id === item.id;
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    className={`projects-home__project${isSelected ? ' projects-home__project--active' : ''}`}
                    onClick={() => void onOpenProject?.(item.id)}
                    disabled={isBusy}
                    aria-current={isSelected ? 'true' : undefined}
                  >
                    <span className="projects-home__project-icon" aria-hidden="true">
                      <FolderGlyph />
                    </span>
                    <span className="projects-home__project-body">
                      <span className="projects-home__project-name">{item.name}</span>
                      <span className="projects-home__project-meta">
                        {item.storage === 'external' && item.folderName ? item.folderName : formatTimestamp(item.updatedAt)}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="projects-home__empty">
            No project folders yet. Pick any folder with the add button: an OpenVideo project inside opens, and any other folder becomes a new project named after it.
          </p>
        )}
      </aside>

      <section className="projects-home__chats" aria-label="Agent chat history">
        <h2 className="projects-home__chats-heading">Chats</h2>
        {chatGroups.length > 0 ? (
          chatGroups.map((group) => (
            <div key={group.id} className="projects-home__chat-group">
              <h3 className="projects-home__chat-group-title">{group.title}</h3>
              <ul className="projects-home__chat-list">
                {group.entries.map((entry) => (
                  <li key={`${entry.projectId}:${entry.conversationId}`}>
                    <button
                      type="button"
                      className="projects-home__chat"
                      onClick={() => void onOpenChat?.(entry)}
                      disabled={isBusy}
                    >
                      <span className="projects-home__chat-title">{entry.title}</span>
                      <span className="projects-home__chat-meta">
                        <span className="projects-home__chat-project">{entry.projectName}</span>
                        <span className="projects-home__chat-time">{formatAgentChatTime(entry.updatedAt)}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))
        ) : (
          <p className="projects-home__empty">
            Edit Agent conversations are saved with their project and will show up here once you chat inside one.
          </p>
        )}
      </section>
    </div>
  );
}
