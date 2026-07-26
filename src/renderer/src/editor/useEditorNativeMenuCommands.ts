import { useEffect, useMemo } from 'react';

import type { TimelineMenuCommandId } from '../../../shared/timelineMenuCommands';
import { getEditorNativeMenuState } from './editorNativeMenuState';
import type {
  EditorFloatingPanelId,
  EditorFloatingPresetId,
  EditorInspectorPlacement,
  EditorLayoutPreference
} from './editorLayoutPreferences';
import type { TimelineEditorController } from './useTimelineEditor';

export { getEditorNativeMenuState } from './editorNativeMenuState';

type EditorNativeMenuCommandsInput = {
  readonly editor: TimelineEditorController;
  readonly isAgentBusy: boolean;
  readonly layoutPreference: EditorLayoutPreference;
  readonly onApplyFloatingPreset: (presetId: EditorFloatingPresetId) => void;
  readonly onResetLayout: () => void;
  readonly onSetFloatingPanelMode: (panelId: EditorFloatingPanelId, floating: boolean) => void;
  readonly onSetInspectorPlacement: (placement: EditorInspectorPlacement) => void;
  readonly onToggleInspector: () => void;
  readonly onToggleLeftDock: () => void;
};

export function useEditorNativeMenuCommands(input: EditorNativeMenuCommandsInput): void {
  const editor = input.editor;
  const layout = input.layoutPreference;
  const menuState = useMemo(() => getEditorNativeMenuState({
    canRedoTimeline: editor.canRedoTimeline,
    canSplitAtPlayhead: editor.selectedClip !== null,
    canUndoTimeline: editor.canUndoTimeline,
    hasProject: editor.project !== null,
    hasUnsavedTimeline: editor.hasUnsavedTimeline,
    isBusy: editor.isBusy || input.isAgentBusy,
    isPlaying: editor.isPlaying,
    layoutPreference: layout
  }), [
    editor.canRedoTimeline,
    editor.canUndoTimeline,
    editor.hasUnsavedTimeline,
    editor.isBusy,
    input.isAgentBusy,
    editor.isPlaying,
    editor.project,
    editor.selectedClip,
    layout
  ]);

  useEffect(() => {
    const handlers: Readonly<Record<TimelineMenuCommandId, () => void>> = {
      playPause: () => editor.setIsPlaying((current) => !current),
      rewind: () => editor.setPlayheadMs(0),
      undo: editor.undoTimeline,
      redo: editor.redoTimeline,
      splitAtPlayhead: editor.splitAtPlayhead,
      addVideoTrack: () => editor.addTimelineTrack('video'),
      addAudioTrack: () => editor.addTimelineTrack('audio'),
      toggleLeftDock: input.onToggleLeftDock,
      toggleInspector: input.onToggleInspector,
      setInspectorLeft: () => input.onSetInspectorPlacement('left'),
      setInspectorRight: () => input.onSetInspectorPlacement('right'),
      setInspectorFloating: () => input.onSetInspectorPlacement('floating'),
      toggleProjectFloating: () => input.onSetFloatingPanelMode('project', !layout.floatingPanels.project.floating),
      toggleProgramFloating: () => input.onSetFloatingPanelMode('program', !layout.floatingPanels.program.floating),
      toggleInspectorFloating: () => input.onSetFloatingPanelMode('inspector', !layout.floatingPanels.inspector.floating),
      toggleExportFloating: () => input.onSetFloatingPanelMode('export', !layout.floatingPanels.export.floating),
      applyCompactReviewPreset: () => input.onApplyFloatingPreset('compactReview'),
      applyReviewDeckPreset: () => input.onApplyFloatingPreset('reviewDeck'),
      resetLayout: input.onResetLayout,
      saveTimeline: () => void editor.saveTimeline()
    };
    return window.videoTool.onTimelineMenuCommand((commandId) => {
      if (menuState.commands[commandId].enabled) handlers[commandId]();
    });
  }, [editor, input, layout, menuState]);

  useEffect(() => {
    const reportMenuState = (): void => window.videoTool.updateTimelineMenuState(menuState);
    reportMenuState();
    window.addEventListener('focus', reportMenuState);
    return () => window.removeEventListener('focus', reportMenuState);
  }, [menuState]);
}
