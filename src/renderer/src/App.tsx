import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactElement } from 'react';

import type { AgentChatHistoryEntry } from '../../shared/agentChat';
import type { EditAgentProjectContext } from '../../shared/editAgentContext';
import { AppShell } from './AppShell';
import type { AgentChatRestoreRequest } from './AgentChatContext';
import { FirstRunOnboarding } from './FirstRunOnboarding';
import { HomePage } from './HomePage';
import { NarrationPanel } from './NarrationPanel';
import { ProjectResultImportProvider } from './ProjectResultImportContext';
import { ProjectsPage } from './ProjectsPage';
import { SettingsWorkspace } from './SettingsWorkspace';
import { VideoGenerationWorkspace } from './VideoGenerationWorkspace';
import { APP_PAGE_BY_ID, getDefaultAppPageId, isProjectRequiredPageId, isWorkspacePageId } from './appPages';
import type { AppPageId } from './appPages';
import { APP_WORKSPACES, getDefaultAppWorkspaceId } from './appWorkspaces';
import type { AppWorkspaceId } from './appWorkspaces';
import { TimelineEditor } from './editor/TimelineEditor';
import { readFirstRunOnboardingCompletion, resetFirstRunOnboardingCompletion, writeFirstRunOnboardingCompletion } from './firstRunOnboardingPreference';
import { useTimelineEditor } from './editor/useTimelineEditor';

const [EDIT_WORKSPACE, VOICE_GENERATION_WORKSPACE, VIDEO_GENERATION_WORKSPACE] = APP_WORKSPACES;

const APP_WORKSPACE_PANEL_STYLE = {
  height: '100%',
  minHeight: 0,
  overflow: 'hidden'
} as const satisfies CSSProperties;

export function App(): ReactElement {
  const editor = useTimelineEditor();
  const [activePageId, setActivePageId] = useState<AppPageId>(() => getDefaultAppPageId());
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<AppWorkspaceId>(() => getDefaultAppWorkspaceId());
  const [showFirstRunOnboarding, setShowFirstRunOnboarding] = useState(() => {
    if (typeof window === 'undefined') return false;
    return !readFirstRunOnboardingCompletion(window.localStorage).completed;
  });
  const pagePanelRefs = useRef<Partial<Record<AppPageId, HTMLElement>>>({});
  const pendingFocusPageRef = useRef<AppPageId | null>(null);
  const [chatHistory, setChatHistory] = useState<readonly AgentChatHistoryEntry[]>([]);
  const [chatRestoreRequest, setChatRestoreRequest] = useState<AgentChatRestoreRequest | null>(null);
  const activePage = APP_PAGE_BY_ID[activePageId];
  const activeProjectContext = useMemo<EditAgentProjectContext | null>(() => {
    if (editor.project === null) return null;

    return {
      projectId: editor.project.id,
      name: editor.project.name,
      assetCount: editor.project.assets.length,
      trackCount: editor.project.timeline.tracks.length
    };
  }, [editor.project]);

  const setPagePanelRef = useCallback((pageId: AppPageId) => (element: HTMLElement | null): void => {
    if (element === null) {
      delete pagePanelRefs.current[pageId];
      return;
    }

    pagePanelRefs.current[pageId] = element;
  }, []);

  const focusPagePanel = useCallback((pageId: AppPageId): void => {
    window.requestAnimationFrame(() => {
      pagePanelRefs.current[pageId]?.focus();
    });
  }, []);

  const requestPageFocus = useCallback((pageId: AppPageId): void => {
    pendingFocusPageRef.current = pageId;
  }, []);

  const hasActiveProject = editor.project !== null;

  const navigateToPage = useCallback((pageId: AppPageId): void => {
    if (pageId === activePageId) {
      focusPagePanel(pageId);
      return;
    }

    requestPageFocus(pageId);
    setActivePageId(pageId);
  }, [activePageId, focusPagePanel, requestPageFocus]);

  const setActivePage = useCallback((pageId: AppPageId): void => {
    // Stage flow guard: Home (Menu) and workspaces need an active project,
    // so project-less navigation lands on Projects instead.
    if (isProjectRequiredPageId(pageId) && !hasActiveProject) {
      navigateToPage('projects');
      return;
    }

    navigateToPage(pageId);
  }, [hasActiveProject, navigateToPage]);

  const setActiveWorkspace = useCallback((workspaceId: AppWorkspaceId): void => {
    if (!hasActiveProject) {
      navigateToPage('projects');
      return;
    }

    if (workspaceId === activeWorkspaceId && activePageId === workspaceId) {
      focusPagePanel(workspaceId);
      return;
    }

    requestPageFocus(workspaceId);
    setActiveWorkspaceId(workspaceId);
    setActivePageId(workspaceId);
  }, [activePageId, activeWorkspaceId, focusPagePanel, hasActiveProject, navigateToPage, requestPageFocus]);

  const completeFirstRunOnboarding = useCallback((): void => {
    writeFirstRunOnboardingCompletion(window.localStorage);
    setShowFirstRunOnboarding(false);
  }, []);

  const replayFirstRunOnboarding = useCallback((): void => {
    resetFirstRunOnboardingCompletion(window.localStorage);
    setShowFirstRunOnboarding(true);
  }, []);

  useEffect(() => {
    const pendingFocusPageId = pendingFocusPageRef.current;
    if (pendingFocusPageId === null || pendingFocusPageId !== activePageId) return;

    pendingFocusPageRef.current = null;
    focusPagePanel(activePageId);
  }, [activePageId, focusPagePanel]);

  useEffect(() => {
    // If the active project disappears (deleted or failed to load) while on a
    // project-required page, fall back to the Projects stage.
    if (hasActiveProject || !isProjectRequiredPageId(activePageId)) return;

    navigateToPage('projects');
  }, [activePageId, hasActiveProject, navigateToPage]);

  useEffect(() => {
    // Refresh the home screen chat history whenever Projects is shown (and as
    // the known project list changes underneath it).
    if (activePageId !== 'projects') return;
    let cancelled = false;
    void window.videoTool.agentChatHistoryList().then((response) => {
      if (cancelled || !response.ok) return;
      setChatHistory(response.value);
    });
    return () => {
      cancelled = true;
    };
  }, [activePageId, editor.projects]);

  const openChatFromHistory = useCallback(async (entry: AgentChatHistoryEntry): Promise<void> => {
    const opened = await editor.openProject(entry.projectId);
    if (!opened) return;
    const conversation = await window.videoTool.agentChatHistoryGet({
      projectId: entry.projectId,
      conversationId: entry.conversationId
    });
    if (conversation.ok && conversation.value !== null) {
      setChatRestoreRequest({ conversationId: conversation.value.id, messages: conversation.value.messages });
    }
    // The project is open at this point, so enter the editor workspace
    // directly (the guarded setters still see the pre-open project state).
    requestPageFocus(EDIT_WORKSPACE.id);
    setActiveWorkspaceId(EDIT_WORKSPACE.id);
    setActivePageId(EDIT_WORKSPACE.id);
  }, [editor, requestPageFocus]);

  const clearChatRestoreRequest = useCallback((): void => {
    setChatRestoreRequest(null);
  }, []);

  const workspaceIsVisible = isWorkspacePageId(activePageId);

  return (
    <AppShell
      activePage={activePage}
      hasActiveProject={hasActiveProject}
      onPageChange={setActivePage}
      activeProjectContext={activeProjectContext}
      chatRestoreRequest={chatRestoreRequest}
      onChatRestoreHandled={clearChatRestoreRequest}
    >
      <ProjectResultImportProvider editor={editor}>
        <div className="app-page-stack">
          <section
            aria-labelledby="home-page-title"
            className="app-page app-page--home"
            hidden={activePageId !== 'home'}
            id="app-page-panel-home"
            ref={setPagePanelRef('home')}
            role="region"
            tabIndex={-1}
          >
            <HomePage
              onWorkspaceOpen={setActiveWorkspace}
              workspaces={APP_WORKSPACES}
              project={editor.project}
              onGoToProjects={() => setActivePage('projects')}
            />
          </section>
          <section
            aria-labelledby="projects-page-title"
            className="app-page app-page--projects"
            hidden={activePageId !== 'projects'}
            id="app-page-panel-projects"
            ref={setPagePanelRef('projects')}
            role="region"
            tabIndex={-1}
          >
            <ProjectsPage
              project={editor.project}
              projects={editor.projects}
              chats={chatHistory}
              onOpenProject={async (projectId) => {
                const opened = await editor.openProject(projectId);
                if (opened) navigateToPage('home');
              }}
              onOpenProjectFolder={async () => {
                const opened = await editor.openProjectFolder();
                if (opened) navigateToPage('home');
              }}
              onOpenChat={openChatFromHistory}
              errorText={editor.statusMessage.tone === 'danger' ? editor.statusMessage.text : undefined}
              isBusy={editor.isBusy}
            />
          </section>
          <div className="app-stack local-edit-bay" hidden={!workspaceIsVisible}>
            <div className="app-workspace-panel-stack">
              <section
                aria-labelledby={EDIT_WORKSPACE.navId}
                hidden={activeWorkspaceId !== EDIT_WORKSPACE.id || !workspaceIsVisible}
                id={EDIT_WORKSPACE.panelId}
                ref={setPagePanelRef(EDIT_WORKSPACE.id)}
                role="region"
                style={APP_WORKSPACE_PANEL_STYLE}
                tabIndex={-1}
              >
                <h2 className="visually-hidden" id={EDIT_WORKSPACE.navId}>{EDIT_WORKSPACE.label}</h2>
                <TimelineEditor editor={editor} />
              </section>
              <section
                aria-labelledby={VOICE_GENERATION_WORKSPACE.navId}
                hidden={activeWorkspaceId !== VOICE_GENERATION_WORKSPACE.id || !workspaceIsVisible}
                id={VOICE_GENERATION_WORKSPACE.panelId}
                ref={setPagePanelRef(VOICE_GENERATION_WORKSPACE.id)}
                role="region"
                style={APP_WORKSPACE_PANEL_STYLE}
                tabIndex={-1}
              >
                <h2 className="visually-hidden" id={VOICE_GENERATION_WORKSPACE.navId}>{VOICE_GENERATION_WORKSPACE.label}</h2>
                <NarrationPanel />
              </section>
              <section
                aria-labelledby={VIDEO_GENERATION_WORKSPACE.navId}
                hidden={activeWorkspaceId !== VIDEO_GENERATION_WORKSPACE.id || !workspaceIsVisible}
                id={VIDEO_GENERATION_WORKSPACE.panelId}
                ref={setPagePanelRef(VIDEO_GENERATION_WORKSPACE.id)}
                role="region"
                style={APP_WORKSPACE_PANEL_STYLE}
                tabIndex={-1}
              >
                <h2 className="visually-hidden" id={VIDEO_GENERATION_WORKSPACE.navId}>{VIDEO_GENERATION_WORKSPACE.label}</h2>
                <VideoGenerationWorkspace />
              </section>
            </div>
          </div>
          <section
            aria-labelledby="settings-title"
            className="app-page app-page--settings"
            hidden={activePageId !== 'settings'}
            id="app-page-panel-settings"
            ref={setPagePanelRef('settings')}
            role="region"
            tabIndex={-1}
          >
            <SettingsWorkspace onReplayFirstRunOnboarding={replayFirstRunOnboarding} />
          </section>
        </div>
      </ProjectResultImportProvider>
      {showFirstRunOnboarding && <FirstRunOnboarding onComplete={completeFirstRunOnboarding} />}
    </AppShell>
  );
}
