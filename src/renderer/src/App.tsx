import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactElement } from 'react';

import type { EditAgentContextAsset } from '../../shared/editAgentContext';
import { AppShell } from './AppShell';
import { FirstRunOnboarding } from './FirstRunOnboarding';
import { HomePage } from './HomePage';
import { NarrationPanel } from './NarrationPanel';
import { ProjectResultImportProvider } from './ProjectResultImportContext';
import { SettingsWorkspace } from './SettingsWorkspace';
import { VideoGenerationWorkspace } from './VideoGenerationWorkspace';
import { APP_PAGE_BY_ID, getDefaultAppPageId, isWorkspacePageId } from './appPages';
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
  const activePage = APP_PAGE_BY_ID[activePageId];
  const selectedContextAsset = useMemo<EditAgentContextAsset | null>(() => {
    if (editor.project === null || editor.selectedAsset === null) return null;

    return {
      projectId: editor.project.id,
      assetId: editor.selectedAsset.id,
      label: editor.selectedAsset.displayName,
      mediaKind: editor.selectedAsset.kind,
      ...(editor.selectedAsset.metadata === null ? {} : { durationMs: editor.selectedAsset.metadata.durationMs })
    };
  }, [editor.project, editor.selectedAsset]);

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

  const setActivePage = useCallback((pageId: AppPageId): void => {
    if (pageId === activePageId) {
      focusPagePanel(pageId);
      return;
    }

    requestPageFocus(pageId);
    setActivePageId(pageId);
  }, [activePageId, focusPagePanel, requestPageFocus]);

  const setActiveWorkspace = useCallback((workspaceId: AppWorkspaceId): void => {
    if (workspaceId === activeWorkspaceId && activePageId === workspaceId) {
      focusPagePanel(workspaceId);
      return;
    }

    requestPageFocus(workspaceId);
    setActiveWorkspaceId(workspaceId);
    setActivePageId(workspaceId);
  }, [activePageId, activeWorkspaceId, focusPagePanel, requestPageFocus]);

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

  const workspaceIsVisible = isWorkspacePageId(activePageId);

  return (
    <AppShell activePage={activePage} onPageChange={setActivePage} selectedContextAsset={selectedContextAsset}>
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
            <HomePage onWorkspaceOpen={setActiveWorkspace} workspaces={APP_WORKSPACES} />
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
          <div
            aria-labelledby="settings-page-title"
            className="app-page app-page--settings"
            hidden={activePageId !== 'settings'}
            id="app-page-panel-settings"
            ref={setPagePanelRef('settings')}
            role="region"
            tabIndex={-1}
          >
            <SettingsWorkspace onReplayFirstRunOnboarding={replayFirstRunOnboarding} />
          </div>
          {showFirstRunOnboarding && <FirstRunOnboarding onComplete={completeFirstRunOnboarding} />}
        </div>
      </ProjectResultImportProvider>
    </AppShell>
  );
}
