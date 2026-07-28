import { useRef, type KeyboardEvent, type PointerEvent, type ReactElement, type ReactNode } from 'react';

import type { EditAgentProjectContext } from '../../shared/editAgentContext';
import {
  AGENT_CHAT_LAYOUT_DEFAULT_WIDTH,
  AGENT_CHAT_LAYOUT_MAX_WIDTH,
  AGENT_CHAT_LAYOUT_MIN_WIDTH,
  clampAgentChatPanelWidth,
  getNextAgentChatPanelWidthFromKey
} from './agentChatLayoutPreferences';
import { isWorkspacePageId, type AppPage, type AppPageId } from './appPages';
import { AgentChatPanel } from './AgentChatPanel';
import { AgentChatProvider, useAgentChat } from './AgentChatContext';
import { ThemeSelector } from './ThemeSelector';
import { Button } from './ui';
import { useAgentChatLayoutPreference } from './useAgentChatLayoutPreference';

type ChatPanelDragOrigin = {
  readonly clientX: number;
  readonly width: number;
};

function AppShellBackground(): ReactElement {
  return (
    <div className="atmosphere" aria-hidden="true">
      <div className="atmosphere__beam atmosphere__beam--left" />
      <div className="atmosphere__beam atmosphere__beam--right" />
      <div className="atmosphere__grain" />
    </div>
  );
}

type AppShellProps = {
  readonly activePage: AppPage;
  readonly children: ReactNode;
  readonly hasActiveProject: boolean;
  readonly onPageChange: (pageId: AppPageId) => void;
  readonly activeProjectContext: EditAgentProjectContext | null;
};

function SettingsIcon(): ReactElement {
  return (
    <svg className="product-chrome__button-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="3" />
      <path d="M18.5 14.5l1.25 1.1-1.8 3.1-1.6-.55a7.4 7.4 0 01-1.45.85L14.6 20.7H9.4L9.1 19a7.4 7.4 0 01-1.45-.85l-1.6.55-1.8-3.1 1.25-1.1a7.2 7.2 0 010-1.7l-1.25-1.1 1.8-3.1 1.6.55c.45-.33.93-.61 1.45-.85l.3-1.7h5.2l.3 1.7c.52.24 1 .52 1.45.85l1.6-.55 1.8 3.1-1.25 1.1c.08.56.08 1.14 0 1.7z" />
    </svg>
  );
}

function HomeIcon(): ReactElement {
  return (
    <svg className="product-chrome__button-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M4.5 11.5L12 5l7.5 6.5" />
      <path d="M6.75 10.25V19h10.5v-8.75" />
      <path d="M10 19v-5h4v5" />
    </svg>
  );
}

function FolderIcon(): ReactElement {
  return (
    <svg className="product-chrome__button-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
    </svg>
  );
}

function getStageBadge(pageId: AppPageId): string {
  switch (pageId) {
    case 'projects':
      return 'Stage 1 · Projects';
    case 'home':
      return 'Stage 2 · Main Menu';
    case 'edit':
    case 'voice-generation':
    case 'video-generation':
      return 'Stage 3 · Workspace';
    case 'settings':
      return 'Settings';
    default:
      return 'Local';
  }
}

function AppShellContent({ activePage, children, hasActiveProject, onPageChange, activeProjectContext }: AppShellProps): ReactElement {
  const { isBusy } = useAgentChat();
  const { layoutPreference, updateLayoutPreference } = useAgentChatLayoutPreference();
  const shellBodyRef = useRef<HTMLDivElement | null>(null);
  const dragOriginRef = useRef<ChatPanelDragOrigin | null>(null);
  const chatPanelWidth = layoutPreference.chatPanelWidth;
  const chatPanelCollapsed = layoutPreference.chatPanelCollapsed;
  const homeIsActive = activePage.id === 'home';
  const projectsIsActive = activePage.id === 'projects';
  const settingsIsActive = activePage.id === 'settings';
  const showChatPanel = isWorkspacePageId(activePage.id);

  const setChatPanelWidth = (width: number): void => {
    const containerWidth = shellBodyRef.current?.getBoundingClientRect().width;
    updateLayoutPreference((currentPreference) => ({
      ...currentPreference,
      chatPanelWidth: clampAgentChatPanelWidth(width, containerWidth)
    }));
  };

  const setChatPanelCollapsed = (collapsed: boolean): void => {
    updateLayoutPreference((currentPreference) => ({
      ...currentPreference,
      chatPanelCollapsed: collapsed
    }));
  };

  const releasePointer = (event: PointerEvent<HTMLDivElement>): void => {
    dragOriginRef.current = null;
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const onChatSplitterKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape' && dragOriginRef.current !== null) {
      event.preventDefault();
      setChatPanelWidth(dragOriginRef.current.width);
      dragOriginRef.current = null;
      return;
    }

    const nextWidth = getNextAgentChatPanelWidthFromKey({ currentWidth: chatPanelWidth, key: event.key, shiftKey: event.shiftKey });
    if (nextWidth === null) return;
    event.preventDefault();
    setChatPanelWidth(nextWidth);
  };

  const onChatSplitterPointerMove = (event: PointerEvent<HTMLDivElement>): void => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId) || dragOriginRef.current === null) return;
    setChatPanelWidth(dragOriginRef.current.width + dragOriginRef.current.clientX - event.clientX);
  };

  const onChatSplitterPointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    event.currentTarget.setPointerCapture(event.pointerId);
    dragOriginRef.current = { clientX: event.clientX, width: chatPanelWidth };
  };

  return (
    <main className="app-shell">
      <AppShellBackground />
      {/* Draggable window titlebar: the native frame is hidden on macOS, so this
          bar owns window dragging; interactive controls opt out via no-drag. */}
      <header className="product-chrome" aria-label="Application chrome" inert={isBusy}>
            <div className="product-chrome__context" aria-label="Current page">
              <span className="product-chrome__stage-pill">{getStageBadge(activePage.id)}</span>
              <span className="product-chrome__workspace">{activePage.chromeLabel}</span>
              {activeProjectContext && (
                <span className="product-chrome__project-pill">📁 Project: {activeProjectContext.name}</span>
              )}
              <span className="local-pill">● Local</span>
            </div>
            <div className="product-chrome__actions">
              <Button
                aria-controls="app-page-panel-projects"
                aria-current={projectsIsActive ? 'page' : undefined}
                className="product-chrome__nav-button"
                onClick={() => onPageChange('projects')}
                variant={projectsIsActive ? 'primary' : 'ghost'}
              >
                <FolderIcon />
                Projects
              </Button>
              <Button
                aria-controls="app-page-panel-home"
                aria-current={homeIsActive ? 'page' : undefined}
                className="product-chrome__nav-button"
                disabled={!hasActiveProject}
                onClick={() => onPageChange('home')}
                title={hasActiveProject ? undefined : 'Open or create a project first'}
                variant={homeIsActive ? 'primary' : 'ghost'}
              >
                <HomeIcon />
                Menu
              </Button>
              <Button
                aria-controls="app-page-panel-settings"
                aria-current={settingsIsActive ? 'page' : undefined}
                className="product-chrome__nav-button"
                onClick={() => onPageChange('settings')}
                variant={settingsIsActive ? 'primary' : 'ghost'}
              >
                <SettingsIcon />
                Settings
              </Button>
              <ThemeSelector />
        </div>
      </header>
      <div ref={shellBodyRef} className="app-shell__body">
        <div id="app-shell-workspace" className="agent-workspace-lock" aria-busy={isBusy} inert={isBusy}>
          <div className="agent-workspace-lock__content">{children}</div>
          {isBusy && (
            <div aria-live="polite">
              <div className="agent-workspace-lock__message" aria-hidden="true">
                Edit Agent is updating your workspace...
              </div>
              <span className="agent-workspace-lock__announcement">Edit Agent is updating your workspace</span>
            </div>
          )}
        </div>
        {showChatPanel && chatPanelCollapsed && (
          <div className="agent-chat-collapsed-rail">
            <button
              className="agent-chat-collapsed-rail__button"
              type="button"
              aria-controls="app-shell-agent-chat"
              aria-expanded={false}
              title="Expand Edit Agent chat sidebar"
              onClick={() => setChatPanelCollapsed(false)}
            >
              <span aria-hidden="true" className="agent-chat-collapsed-rail__glyph">⇤</span>
              <span className="agent-chat-collapsed-rail__label">Edit Agent</span>
            </button>
          </div>
        )}
        {showChatPanel && !chatPanelCollapsed && (
          <>
            <div
              aria-controls="app-shell-workspace app-shell-agent-chat"
              aria-label="Resize Edit Agent chat panel"
              aria-orientation="vertical"
              aria-valuemax={AGENT_CHAT_LAYOUT_MAX_WIDTH}
              aria-valuemin={AGENT_CHAT_LAYOUT_MIN_WIDTH}
              aria-valuenow={chatPanelWidth}
              aria-valuetext={`Edit Agent chat ${chatPanelWidth} pixels`}
              className="agent-chat-resize-splitter"
              onKeyDown={onChatSplitterKeyDown}
              onPointerDown={onChatSplitterPointerDown}
              onPointerMove={onChatSplitterPointerMove}
              onPointerUp={releasePointer}
              role="separator"
              tabIndex={0}
              title="Drag to resize Edit Agent chat panel"
            />
            <AgentChatPanel width={chatPanelWidth} onCollapse={() => setChatPanelCollapsed(true)} />
          </>
        )}
      </div>
    </main>
  );
}

export function AppShell(props: AppShellProps): ReactElement {
  return (
    <AgentChatProvider activeProject={props.activeProjectContext}>
      <AppShellContent {...props} />
    </AgentChatProvider>
  );
}
