import { useEffect, useState, type CSSProperties, type ReactElement, type ReactNode } from 'react';
import { EditorWorkspace } from '../../../../external/opencut/apps/web/src/components/editor/editor-workspace';

import { AssetMetadataProbeHost } from './AssetMetadataProbeHost';
import { EDITOR_INSPECTOR_DOCK_TAB_IDS, getDefaultEditorDockTabs, getDefaultEditorLeftDockTabId } from './dockTabs';
import type { EditorLeftDockTabId } from './dockTabs';
import { EditorFloatingPanelFrame } from './EditorFloatingPanelFrame';
import {
  bringEditorFloatingPanelToFront,
  clampEditorInspectorWidth,
  clampEditorLeftDockWidth,
  clampEditorProgramPercent,
  EDITOR_LAYOUT_FLOATING_PRESETS,
  moveEditorFloatingPanel,
  resetEditorLayoutPreference,
  setEditorFloatingPanelMode,
  setEditorFloatingPanels,
  setEditorInspectorPlacement,
  toggleEditorInspector,
  toggleEditorLeftDock,
  type EditorFloatingPanel,
  type EditorFloatingPanelId,
  type EditorFloatingPresetId,
  type EditorLayoutPreference
} from './editorLayoutPreferences';
import { ExportPanel } from './ExportPanel';
import { InspectorPanel } from './InspectorPanel';
import { ProgramMonitor } from './ProgramMonitor';
import { ProjectRail } from './ProjectRail';
import { TimelineCanvas } from './TimelineCanvas';
import { TimelineEditorLeftDock } from './TimelineEditorLeftDock';
import { EditorInspectorSplitter, EditorLeftDockSplitter, EditorProgramSplitter } from './TimelineEditorLayoutControls';
import { useEditorLayoutPreference } from './useEditorLayoutPreference';
import { useEditorNativeMenuCommands } from './useEditorNativeMenuCommands';
import { useEditorShortcutPreference } from './useEditorShortcutPreference';
import type { TimelineEditorController } from './useTimelineEditor';
import { useTimelineShortcuts } from './useTimelineShortcuts';
import { useAgentChat } from '../AgentChatContext';
import { useTheme } from '../ThemeProvider';
import { THEME_PRESETS, type ThemePresetId } from '../theme';
import type { TabDefinition } from '../ui';

export type InspectorTabId = (typeof EDITOR_INSPECTOR_DOCK_TAB_IDS)[number];

type TimelineEditorProps = {
  readonly editor: TimelineEditorController;
};

const INSPECTOR_TAB_LABELS: Readonly<Record<InspectorTabId, string>> = {
  asset: 'Asset',
  selection: 'Selection'
};

function getInspectorTabs(editor: TimelineEditorController): readonly TabDefinition<InspectorTabId>[] {
  const dockTabs = editor.project === null ? null : getDefaultEditorDockTabs(editor.project).inspector;

  return EDITOR_INSPECTOR_DOCK_TAB_IDS.map((tabId) => {
    const dockTab = dockTabs?.find((tab) => tab.id === tabId);
    const label = dockTab?.label ?? INSPECTOR_TAB_LABELS[tabId];
    // Without a project there is nothing to inspect at all.
    const disabled = editor.project === null ? true : dockTab?.disabled === true;

    return disabled ? { id: tabId, label, disabled: true } : { id: tabId, label };
  });
}

type InspectorIdentityInput = {
  readonly selectedAssetId: string;
  readonly selectedClipId: string;
};

type EditorWorkspaceStyle = CSSProperties & {
  readonly '--editor-left-dock-width': string;
  readonly '--editor-inspector-width': string;
  readonly '--editor-program-percent': string;
  readonly '--editor-timeline-percent': string;
};

const FLOATING_PANEL_LABELS: Readonly<Record<EditorFloatingPanelId, string>> = {
  export: 'Export',
  inspector: 'Inspector',
  program: 'Program Monitor',
  project: 'Project Dock'
};

type FloatingPanelRenderInput = {
  readonly child: ReactNode;
  readonly floatingPanel: EditorFloatingPanel;
  readonly panelId: EditorFloatingPanelId;
};

function getDefaultInspectorTabId({ selectedAssetId, selectedClipId }: InspectorIdentityInput): InspectorTabId {
  if (selectedAssetId.length > 0 && selectedClipId.length === 0) return 'asset';
  return 'selection';
}

export function TimelineEditor({ editor }: TimelineEditorProps): ReactElement {
  const { isBusy: isAgentBusy } = useAgentChat();
  const { mode: themeMode, preset, setPreset, toggleTheme } = useTheme();
  const [leftDockTabId, setLeftDockTabId] = useState<EditorLeftDockTabId>('project');
  const [inspectorTabId, setInspectorTabId] = useState<InspectorTabId>('selection');
  const { layoutPreference, updateLayoutPreference } = useEditorLayoutPreference();
  const { shortcutPreferences } = useEditorShortcutPreference();
  const inspectorTabs = getInspectorTabs(editor);
  const projectIdentity = editor.project?.id ?? '';
  const selectedAssetIdentity = editor.selectedAsset?.id ?? '';
  const selectedClipIdentity = editor.selectedClip?.clip.id ?? '';

  useEffect(() => {
    setInspectorTabId(getDefaultInspectorTabId({ selectedAssetId: selectedAssetIdentity, selectedClipId: selectedClipIdentity }));
  }, [projectIdentity, selectedAssetIdentity, selectedClipIdentity]);

  useEffect(() => {
    setLeftDockTabId(getDefaultEditorLeftDockTabId({ hasProject: projectIdentity.length > 0, selectedAssetId: '' }));
  }, [projectIdentity]);

  const setProgramPercent = (programPercent: number): void => {
    updateLayoutPreference((currentPreference) => ({ ...currentPreference, programPercent: clampEditorProgramPercent(programPercent) }));
  };

  const setLeftDockWidth = (leftDockWidth: number): void => {
    updateLayoutPreference((currentPreference) => ({ ...currentPreference, leftDockWidth: clampEditorLeftDockWidth(leftDockWidth) }));
  };

  const setInspectorWidth = (inspectorWidth: number): void => {
    updateLayoutPreference((currentPreference) => ({ ...currentPreference, inspectorWidth: clampEditorInspectorWidth(inspectorWidth) }));
  };

  const workspaceClassName = [
    layoutPreference.leftDockVisible ? null : 'oc-editor-host--left-hidden',
    layoutPreference.inspectorVisible ? null : 'oc-editor-host--inspector-hidden',
    `oc-editor-host--inspector-${layoutPreference.inspectorPlacement}`
  ].filter((className): className is string => className !== null).join(' ');

  const workspaceStyle: EditorWorkspaceStyle = {
    '--editor-left-dock-width': `${layoutPreference.leftDockWidth}px`,
    '--editor-inspector-width': `${layoutPreference.inspectorWidth}px`,
    '--editor-program-percent': `${layoutPreference.programPercent}fr`,
    '--editor-timeline-percent': `${100 - layoutPreference.programPercent}fr`
  };

  const inspectorPanel = <InspectorPanel activeTabId={inspectorTabId} editor={editor} tabs={inspectorTabs} onActiveTabChange={setInspectorTabId} />;
  const dockedInspectorVisible = layoutPreference.inspectorVisible && layoutPreference.inspectorPlacement !== 'floating';
  const floatingProjectVisible = layoutPreference.floatingPanels.project.floating;
  const floatingProgramVisible = layoutPreference.floatingPanels.program.floating;
  const floatingInspectorVisible = layoutPreference.inspectorVisible && layoutPreference.floatingPanels.inspector.floating;
  const floatingExportVisible = layoutPreference.floatingPanels.export.floating;
  const resetLayout = (): void => updateLayoutPreference(() => resetEditorLayoutPreference());
  const toggleInspector = (): void => updateLayoutPreference(toggleEditorInspector);
  const toggleLeftDock = (): void => updateLayoutPreference(toggleEditorLeftDock);
  const setFloatingPanelMode = (panelId: EditorFloatingPanelId, floating: boolean): void => {
    updateLayoutPreference((currentPreference) => setEditorFloatingPanelMode(currentPreference, panelId, floating));
  };
  const setInspectorPlacement = (placement: EditorLayoutPreference['inspectorPlacement']): void => {
    updateLayoutPreference((currentPreference) => setEditorInspectorPlacement(currentPreference, placement));
  };
  const applyFloatingPreset = (presetId: EditorFloatingPresetId): void => {
    updateLayoutPreference((currentPreference) => setEditorFloatingPanels(currentPreference, EDITOR_LAYOUT_FLOATING_PRESETS[presetId].floatingPanels));
  };
  const focusFloatingPanel = (panelId: EditorFloatingPanelId): void => {
    updateLayoutPreference((currentPreference) => bringEditorFloatingPanelToFront(currentPreference, panelId));
  };
  const moveFloatingPanel = (panelId: EditorFloatingPanelId, panel: EditorFloatingPanel): void => {
    updateLayoutPreference((currentPreference) => moveEditorFloatingPanel(currentPreference, panelId, panel));
  };
  const renderFloatingPanel = ({ child, floatingPanel, panelId }: FloatingPanelRenderInput): ReactElement => (
    <EditorFloatingPanelFrame
      key={panelId}
      label={FLOATING_PANEL_LABELS[panelId]}
      panel={floatingPanel}
      panelId={panelId}
      onClose={(id) => setFloatingPanelMode(id, false)}
      onFocusPanel={focusFloatingPanel}
      onMovePanel={moveFloatingPanel}
    >
      {child}
    </EditorFloatingPanelFrame>
  );

  useTimelineShortcuts({
    canSplit: editor.selectedClip !== null,
    isLocked: isAgentBusy,
    clearSelection: editor.clearSelection,
    deleteSelectedClip: editor.deleteSelectedClip,
    duplicateSelectedClip: editor.duplicateSelectedClip,
    goToTimelineEnd: editor.goToTimelineEnd,
    goToTimelineStart: editor.goToTimelineStart,
    moveSelectedClip: editor.moveSelectedClip,
    saveTimeline: () => { void editor.saveTimeline(); },
    stepPlayhead: editor.stepPlayhead,
    redoTimeline: editor.redoTimeline,
    resetLayout,
    selectAllClips: editor.selectAllClips,
    setIsPlaying: editor.setIsPlaying,
    shortcutPreferences,
    splitAtPlayhead: editor.splitAtPlayhead,
    toggleInspector,
    toggleLeftDock,
    undoTimeline: editor.undoTimeline
  });

  useEditorNativeMenuCommands({
    editor,
    isAgentBusy,
    layoutPreference,
    onApplyFloatingPreset: applyFloatingPreset,
    onResetLayout: resetLayout,
    onSetFloatingPanelMode: setFloatingPanelMode,
    onSetInspectorPlacement: setInspectorPlacement,
    onToggleInspector: toggleInspector,
    onToggleLeftDock: toggleLeftDock
  });

  return (
    <EditorWorkspace
      mode="host"
      className={workspaceClassName}
      style={workspaceStyle}
      labelledBy="timeline-editor-title"
      header={<>
        <strong className="oc-editor-host__brand">OpenScene</strong>
        <span className="oc-editor-host__project" title={editor.project?.name ?? 'No project'}>{editor.project?.name ?? 'No project'}</span>
        <span className="oc-editor-host__header-spacer" />
        <select className="oc-editor-theme-picker" aria-label="Editor theme preset" value={preset} onChange={(event) => setPreset(event.currentTarget.value as ThemePresetId)}>
          {THEME_PRESETS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
        </select>
        <button className="oc-editor-host__save" type="button" onClick={toggleTheme} aria-label={`Switch to ${themeMode === 'dark' ? 'light' : 'dark'} theme`} title={`Switch to ${themeMode === 'dark' ? 'light' : 'dark'} theme`}>{themeMode === 'dark' ? '☀' : '☾'}</button>
        <button className="oc-editor-host__save" type="button" onClick={() => { void editor.saveTimeline(); }} disabled={editor.project === null || !editor.hasUnsavedTimeline}>Save{editor.hasUnsavedTimeline ? ' *' : ''}</button>
        {!floatingExportVisible && <ExportPanel editor={editor} />}
      </>}
      left={<TimelineEditorLeftDock
        activeTabId={leftDockTabId}
        editor={editor}
        leftDockVisible={layoutPreference.leftDockVisible}
        projectPanelFloating={layoutPreference.floatingPanels.project.floating}
        onActiveTabChange={setLeftDockTabId}
      />}

      leftSplitter={<EditorLeftDockSplitter leftDockVisible={layoutPreference.leftDockVisible} leftDockWidth={layoutPreference.leftDockWidth} onLeftDockWidthChange={setLeftDockWidth} />}

      auxiliary={<AssetMetadataProbeHost
        failuresByAssetId={editor.metadataProbeFailuresByAssetId}
        onMetadata={editor.updateAssetMetadata}
        onProbeFailure={editor.reportMetadataProbeFailure}
        project={editor.project}
        retryRevisionsByAssetId={editor.metadataProbeRetryRevisionsByAssetId}
      />}

      program={<main className="editor-program-region" id="editor-program-panel" aria-labelledby="timeline-editor-title">
        {/* Keep the monitor's accessible heading while OpenCut renders the visible project header. */}
        <div className="visually-hidden">
          <p className="section-kicker">Local studio</p>
          <h1 id="timeline-editor-title">OpenScene</h1>
          <span className="editor-program-region__subtitle">Timeline editor</span>
        </div>
        {floatingProgramVisible ? <div className="empty-slate">Program Monitor is floating above the workspace.</div> : <ProgramMonitor editor={editor} />}
      </main>}

      programSplitter={<EditorProgramSplitter programPercent={layoutPreference.programPercent} onProgramPercentChange={setProgramPercent} />}

      inspector={dockedInspectorVisible ? inspectorPanel : null}

      inspectorSplitter={<EditorInspectorSplitter
        inspectorPlacement={layoutPreference.inspectorPlacement}
        inspectorVisible={layoutPreference.inspectorVisible}
        inspectorWidth={layoutPreference.inspectorWidth}
        leftDockVisible={layoutPreference.leftDockVisible}
        leftDockWidth={layoutPreference.leftDockWidth}
        onInspectorWidthChange={setInspectorWidth}
      />}

      floatingPanels={<div className="editor-floating-layer" aria-label="Floating workspace panels">
        {floatingProjectVisible && renderFloatingPanel({ child: <ProjectRail editor={editor} />, floatingPanel: layoutPreference.floatingPanels.project, panelId: 'project' })}
        {floatingProgramVisible && renderFloatingPanel({ child: <ProgramMonitor editor={editor} />, floatingPanel: layoutPreference.floatingPanels.program, panelId: 'program' })}
        {floatingInspectorVisible && renderFloatingPanel({ child: inspectorPanel, floatingPanel: layoutPreference.floatingPanels.inspector, panelId: 'inspector' })}
        {floatingExportVisible && renderFloatingPanel({ child: <ExportPanel editor={editor} />, floatingPanel: layoutPreference.floatingPanels.export, panelId: 'export' })}
      </div>}

      timeline={<TimelineCanvas id="editor-timeline-panel" editor={editor} />}
    />
  );
}
