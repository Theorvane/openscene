import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactElement } from 'react';

import { AppShell } from './AppShell';
import { AppWorkspaceNavigation } from './AppWorkspaceNavigation';
import { NarrationPanel } from './NarrationPanel';
import { ProjectResultImportProvider } from './ProjectResultImportContext';
import { VideoGenerationWorkspace } from './VideoGenerationWorkspace';
import { APP_WORKSPACES, getDefaultAppWorkspaceId } from './appWorkspaces';
import type { AppWorkspace, AppWorkspaceId } from './appWorkspaces';
import { TimelineEditor } from './editor/TimelineEditor';
import { useTimelineEditor } from './editor/useTimelineEditor';

const [EDIT_WORKSPACE, VIDEO_GENERATION_WORKSPACE, VOICE_GENERATION_WORKSPACE] = APP_WORKSPACES;

const APP_WORKSPACE_BY_ID = {
  edit: EDIT_WORKSPACE,
  'video-generation': VIDEO_GENERATION_WORKSPACE,
  'voice-generation': VOICE_GENERATION_WORKSPACE
} as const satisfies Readonly<Record<AppWorkspaceId, AppWorkspace>>;

const APP_WORKSPACE_LAYOUT_STYLE = {
  gridTemplateColumns: 'minmax(184px, 220px) minmax(0, 1fr)',
  gridTemplateRows: 'minmax(0, 1fr)'
} as const satisfies CSSProperties;

const APP_WORKSPACE_PANEL_STACK_STYLE = {
  minHeight: 0,
  overflow: 'hidden'
} as const satisfies CSSProperties;

const APP_WORKSPACE_PANEL_STYLE = {
  height: '100%',
  minHeight: 0,
  overflow: 'hidden'
} as const satisfies CSSProperties;

export function App(): ReactElement {
  const editor = useTimelineEditor();
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<AppWorkspaceId>(() => getDefaultAppWorkspaceId());
  const workspacePanelRefs = useRef<Partial<Record<AppWorkspaceId, HTMLElement>>>({});
  const shouldFocusActivePanelRef = useRef(false);
  const activeWorkspace = APP_WORKSPACE_BY_ID[activeWorkspaceId];

  const setWorkspacePanelRef = useCallback((workspaceId: AppWorkspaceId) => (element: HTMLElement | null): void => {
    if (element === null) {
      delete workspacePanelRefs.current[workspaceId];
      return;
    }

    workspacePanelRefs.current[workspaceId] = element;
  }, []);

  const focusWorkspacePanel = useCallback((workspaceId: AppWorkspaceId): void => {
    window.requestAnimationFrame(() => {
      workspacePanelRefs.current[workspaceId]?.focus();
    });
  }, []);

  const setActiveWorkspace = useCallback((workspaceId: AppWorkspaceId): void => {
    if (workspaceId === activeWorkspaceId) {
      focusWorkspacePanel(workspaceId);
      return;
    }

    shouldFocusActivePanelRef.current = true;
    setActiveWorkspaceId(workspaceId);
  }, [activeWorkspaceId, focusWorkspacePanel]);

  useEffect(() => {
    if (!shouldFocusActivePanelRef.current) return;

    shouldFocusActivePanelRef.current = false;
    focusWorkspacePanel(activeWorkspaceId);
  }, [activeWorkspaceId, focusWorkspacePanel]);

  return (
    <AppShell activeWorkspace={activeWorkspace}>
      <ProjectResultImportProvider editor={editor}>
        <div className="app-stack local-edit-bay" style={APP_WORKSPACE_LAYOUT_STYLE}>
          <AppWorkspaceNavigation activeWorkspaceId={activeWorkspaceId} onActiveWorkspaceChange={setActiveWorkspace} />
          <div style={APP_WORKSPACE_PANEL_STACK_STYLE}>
            <section
              aria-labelledby={EDIT_WORKSPACE.navId}
              hidden={activeWorkspaceId !== EDIT_WORKSPACE.id}
              id={EDIT_WORKSPACE.panelId}
              ref={setWorkspacePanelRef(EDIT_WORKSPACE.id)}
              role="region"
              style={APP_WORKSPACE_PANEL_STYLE}
              tabIndex={-1}
            >
              <TimelineEditor editor={editor} />
            </section>
            <section
              aria-labelledby={VIDEO_GENERATION_WORKSPACE.navId}
              hidden={activeWorkspaceId !== VIDEO_GENERATION_WORKSPACE.id}
              id={VIDEO_GENERATION_WORKSPACE.panelId}
              ref={setWorkspacePanelRef(VIDEO_GENERATION_WORKSPACE.id)}
              role="region"
              style={APP_WORKSPACE_PANEL_STYLE}
              tabIndex={-1}
            >
              <VideoGenerationWorkspace />
            </section>
            <section
              aria-labelledby={VOICE_GENERATION_WORKSPACE.navId}
              hidden={activeWorkspaceId !== VOICE_GENERATION_WORKSPACE.id}
              id={VOICE_GENERATION_WORKSPACE.panelId}
              ref={setWorkspacePanelRef(VOICE_GENERATION_WORKSPACE.id)}
              role="region"
              style={APP_WORKSPACE_PANEL_STYLE}
              tabIndex={-1}
            >
              <NarrationPanel />
            </section>
          </div>
        </div>
      </ProjectResultImportProvider>
    </AppShell>
  );
}
