import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactElement } from 'react';

import type { AgentChatHistoryEntry } from '../../shared/agentChat';
import type { EditAgentProjectContext } from '../../shared/editAgentContext';
import { AppShell } from './AppShell';
import type { AgentChatRestoreRequest } from './AgentChatContext';
import { FirstRunOnboarding } from './FirstRunOnboarding';
import { ProjectResultImportProvider } from './ProjectResultImportContext';
import { Tabs } from './ui';
import { closeProjectTab, openProjectTab, pruneProjectTabs, type ProjectTab } from './projectTabs';
import { ProjectSettingsDialog } from './ProjectSettingsDialog';
import { NarrationPanel } from './NarrationPanel';
import type { ReferenceImageSelection } from '../../shared/providerSeams';
import { ImageGenerationWorkspace } from './ImageGenerationWorkspace';
import { VideoGenerationWorkspace } from './VideoGenerationWorkspace';
import {
  WORKSPACE_TAB_IDS,
  WORKSPACE_TAB_LABELS,
  WORKSPACE_TAB_STORAGE_KEY,
  parseWorkspaceTabId,
  type WorkspaceTabId
} from './workspaceTabs';
import { ProjectsPage } from './ProjectsPage';
import { SettingsWorkspace } from './SettingsWorkspace';
import { APP_PAGE_BY_ID, getDefaultAppPageId, isProjectRequiredPageId, isWorkspacePageId } from './appPages';
import type { AppPageId } from './appPages';
import { popPageHistory, pushPageHistory } from './appNavigationHistory';
import { APP_WORKSPACES, getDefaultAppWorkspaceId } from './appWorkspaces';
import type { AppWorkspaceId } from './appWorkspaces';
import { TimelineEditor } from './editor/TimelineEditor';
import { readFirstRunOnboardingCompletion, resetFirstRunOnboardingCompletion, writeFirstRunOnboardingCompletion } from './firstRunOnboardingPreference';
import { useTimelineEditor } from './editor/useTimelineEditor';

const [EDIT_WORKSPACE] = APP_WORKSPACES;

const APP_WORKSPACE_PANEL_STYLE = {
  height: '100%',
  minHeight: 0,
  overflow: 'hidden'
} as const satisfies CSSProperties;

function SettingsGlyph(): ReactElement {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="3.2" />
      <path d="M19.4 15a1.7 1.7 0 00.34 1.88l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.7 1.7 0 00-1.88-.34 1.7 1.7 0 00-1 1.56V21a2 2 0 11-4 0v-.09A1.7 1.7 0 008 19.4a1.7 1.7 0 00-1.88.34l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.7 1.7 0 00.34-1.88 1.7 1.7 0 00-1.56-1H2a2 2 0 110-4h.09A1.7 1.7 0 004.6 8a1.7 1.7 0 00-.34-1.88l-.06-.06a2 2 0 112.83-2.83l.06.06A1.7 1.7 0 009 3.63 1.7 1.7 0 0010 2.07V2a2 2 0 114 0v.09a1.7 1.7 0 001 1.56 1.7 1.7 0 001.88-.34l.06-.06a2 2 0 112.83 2.83l-.06.06A1.7 1.7 0 0019.4 8v0a1.7 1.7 0 001.56 1H21a2 2 0 110 4h-.09a1.7 1.7 0 00-1.56 1z" />
    </svg>
  );
}

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
  const [pageHistory, setPageHistory] = useState<readonly AppPageId[]>([]);
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

    setPageHistory((current) => pushPageHistory(current, activePageId));
    requestPageFocus(pageId);
    setActivePageId(pageId);
  }, [activePageId, focusPagePanel, requestPageFocus]);

  const navigateBack = useCallback((): void => {
    const { target, rest } = popPageHistory(pageHistory);
    if (target === null) return;
    setPageHistory(rest);
    // Same guard as forward navigation: a project-required page in history
    // becomes Projects when the project is gone.
    const resolved = isProjectRequiredPageId(target) && editor.project === null ? 'projects' : target;
    requestPageFocus(resolved);
    if (isWorkspacePageId(resolved)) setActiveWorkspaceId(resolved);
    setActivePageId(resolved);
  }, [editor.project, pageHistory, requestPageFocus]);

  const setActivePage = useCallback((pageId: AppPageId): void => {
    // Stage flow guard: Home (Menu) and workspaces need an active project,
    // so project-less navigation lands on Projects instead.
    if (isProjectRequiredPageId(pageId) && !hasActiveProject) {
      navigateToPage('projects');
      return;
    }

    navigateToPage(pageId);
  }, [hasActiveProject, navigateToPage]);


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

  const removeProject = useCallback(async (projectId: string): Promise<void> => {
    // Removing the open project has to clear the editor too, which
    // deleteCurrentProject already does; other rows only need the store call.
    if (editor.project?.id === projectId) {
      await editor.deleteCurrentProject();
    } else {
      const response = await window.videoTool.deleteProject({ projectId });
      if (!response.ok) return;
      await editor.refreshProjects();
    }
    const chats = await window.videoTool.agentChatHistoryList();
    if (chats.ok) setChatHistory(chats.value);
  }, [editor]);

  const deleteChatFromHistory = useCallback(async (entry: AgentChatHistoryEntry): Promise<void> => {
    const response = await window.videoTool.agentChatHistoryDelete({
      projectId: entry.projectId,
      conversationId: entry.conversationId
    });
    if (!response.ok) return;
    setChatHistory((current) => current.filter((item) =>
      item.projectId !== entry.projectId || item.conversationId !== entry.conversationId
    ));
  }, []);

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
    setPageHistory((current) => pushPageHistory(current, activePageId));
    requestPageFocus(EDIT_WORKSPACE.id);
    setActiveWorkspaceId(EDIT_WORKSPACE.id);
    setActivePageId(EDIT_WORKSPACE.id);
  }, [activePageId, editor, requestPageFocus]);

  const clearChatRestoreRequest = useCallback((): void => {
    setChatRestoreRequest(null);
  }, []);

  const workspaceIsVisible = isWorkspacePageId(activePageId);
  const [projectTabs, setProjectTabs] = useState<readonly ProjectTab[]>([]);

  // A project deleted from the list must not linger as an unopenable tab.
  useEffect(() => {
    setProjectTabs((current) => pruneProjectTabs(current, editor.projects.map((project) => project.id)));
  }, [editor.projects]);

  useEffect(() => {
    if (editor.project === null) return;
    setProjectTabs((current) => openProjectTab(current, { id: editor.project!.id, name: editor.project!.name }));
  }, [editor.project?.id, editor.project?.name]);

  /**
   * Tabs share one editor, so the timeline in memory belongs to whichever
   * project is open. Persist unsaved work before loading the next one rather
   * than dropping it on a tab click.
   */
  const selectProjectTab = useCallback(async (projectId: string): Promise<void> => {
    if (editor.project?.id === projectId) return;
    if (editor.hasUnsavedTimeline) await editor.saveTimeline();
    const opened = await editor.openProject(projectId);
    if (opened) navigateToPage('edit');
  }, [editor, navigateToPage]);

  const closeProjectTabById = useCallback(async (projectId: string): Promise<void> => {
    const next = closeProjectTab(projectTabs, projectId, editor.project?.id ?? null);
    setProjectTabs(next.tabs);
    if (editor.project?.id !== projectId) return;
    if (editor.hasUnsavedTimeline) await editor.saveTimeline();
    if (next.activeId === null) {
      navigateToPage('projects');
      return;
    }
    await editor.openProject(next.activeId);
  }, [editor, navigateToPage, projectTabs]);
  const [projectSettingsOpen, setProjectSettingsOpen] = useState(false);
  // Which workspace surface is showing; remembered across launches.
  const [workspaceTabId, setWorkspaceTabId] = useState<WorkspaceTabId>(() =>
    typeof window === 'undefined' ? 'edit' : parseWorkspaceTabId(window.localStorage.getItem(WORKSPACE_TAB_STORAGE_KEY))
  );

  // Lives here because both studios touch it: the image studio produces a still
  // and the video studio consumes it as an image-to-video seed.
  const [videoReferenceImage, setVideoReferenceImage] = useState<ReferenceImageSelection | null>(null);

  const selectWorkspaceTab = (tabId: WorkspaceTabId): void => {
    setWorkspaceTabId(tabId);
    try {
      window.localStorage.setItem(WORKSPACE_TAB_STORAGE_KEY, tabId);
    } catch {
      // The in-memory choice stays usable when local storage is unavailable.
    }
  };

  return (
    // The result-import provider wraps the shell, not just the page stack: the
    // Studio side panel lives in the shell and imports what it generates.
    <ProjectResultImportProvider editor={editor}>
      <AppShell
        activePage={activePage}
        hasActiveProject={hasActiveProject}
        onPageChange={setActivePage}
        activeProjectContext={activeProjectContext}
        projectTabs={projectTabs}
        activeProjectId={editor.project?.id ?? null}
        onSelectProjectTab={(projectId) => void selectProjectTab(projectId)}
        onCloseProjectTab={(projectId) => void closeProjectTabById(projectId)}
        chatRestoreRequest={chatRestoreRequest}
        onChatRestoreHandled={clearChatRestoreRequest}
        canNavigateBack={pageHistory.length > 0}
        onNavigateBack={navigateBack}
      >
      <div className="app-page-stack">
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
                if (opened) navigateToPage('edit');
              }}
              onOpenProjectFolder={async () => {
                const opened = await editor.openProjectFolder();
                if (opened) navigateToPage('edit');
              }}
              onOpenChat={openChatFromHistory}
              onRemoveProject={removeProject}
              onDeleteChat={deleteChatFromHistory}
              errorText={editor.statusMessage.tone === 'danger' ? editor.statusMessage.text : undefined}
              isBusy={editor.isBusy}
            />
          </section>
          <div className="app-stack local-edit-bay" hidden={!workspaceIsVisible}>
            {/* Workspace switcher: the editor and the two generation studios
                share the area, so a generated clip lands on the timeline
                without leaving the workspace or the agent chat beside it. */}
            <div className="workspace-tab-line">
              <Tabs
                activeTabId={workspaceTabId}
                idBase="workspace"
                tabs={WORKSPACE_TAB_IDS.map((id) => ({ id, label: WORKSPACE_TAB_LABELS[id] }))}
                onActiveTabChange={selectWorkspaceTab}
                className="workspace-tabs"
                aria-label="Workspace sections"
              />
              <button
                type="button"
                className="workspace-settings-button"
                aria-label="Project settings"
                title="Project settings"
                disabled={editor.project === null}
                onClick={() => setProjectSettingsOpen(true)}
              >
                <SettingsGlyph />
              </button>
            </div>
            <div className="app-workspace-panel-stack">
              <section
                aria-labelledby={EDIT_WORKSPACE.navId}
                hidden={workspaceTabId !== 'edit' || activeWorkspaceId !== EDIT_WORKSPACE.id || !workspaceIsVisible}
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
                aria-label={WORKSPACE_TAB_LABELS.voice}
                className="workspace-studio-panel"
                hidden={workspaceTabId !== 'voice' || !workspaceIsVisible}
                role="region"
                style={APP_WORKSPACE_PANEL_STYLE}
                tabIndex={-1}
              >
                <NarrationPanel />
              </section>
              <section
                aria-label={WORKSPACE_TAB_LABELS.video}
                className="workspace-studio-panel"
                hidden={workspaceTabId !== 'video' || !workspaceIsVisible}
                role="region"
                style={APP_WORKSPACE_PANEL_STYLE}
                tabIndex={-1}
              >
                <VideoGenerationWorkspace
                  referenceImage={videoReferenceImage}
                  onReferenceImageChange={setVideoReferenceImage}
                />
              </section>
              <section
                aria-label={WORKSPACE_TAB_LABELS.image}
                className="workspace-studio-panel"
                hidden={workspaceTabId !== 'image' || !workspaceIsVisible}
                role="region"
                style={APP_WORKSPACE_PANEL_STYLE}
                tabIndex={-1}
              >
                <ImageGenerationWorkspace
                  onUseForVideo={(reference) => {
                    setVideoReferenceImage(reference);
                    selectWorkspaceTab('video');
                  }}
                />
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
      {projectSettingsOpen && editor.project !== null && (
        <ProjectSettingsDialog
          project={editor.project}
          summary={editor.projects.find((item) => item.id === editor.project?.id)}
          isBusy={editor.isBusy}
          onRename={editor.renameProject}
          onRemove={async () => {
            setProjectSettingsOpen(false);
            await removeProject(editor.project!.id);
          }}
          onClose={() => setProjectSettingsOpen(false)}
        />
      )}
      {showFirstRunOnboarding && <FirstRunOnboarding onComplete={completeFirstRunOnboarding} />}
      </AppShell>
    </ProjectResultImportProvider>
  );
}
