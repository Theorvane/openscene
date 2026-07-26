import { useEffect } from 'react';

import {
  getEditorShortcutBindings,
  isEditorShortcutEventMatch,
  type EditorShortcutActionId,
  type EditorShortcutPreferences
} from './editorShortcuts';
import { isTextEditingShortcutTarget } from './editorTimelineView';

type TimelineShortcutInput = {
  readonly canSplit: boolean;
  readonly isLocked: boolean;
  readonly deleteSelectedClip: () => void;
  readonly redoTimeline: () => void;
  readonly resetLayout: () => void;
  readonly setIsPlaying: (update: (current: boolean) => boolean) => void;
  readonly shortcutPreferences: EditorShortcutPreferences;
  readonly splitAtPlayhead: () => void;
  readonly toggleInspector: () => void;
  readonly toggleLeftDock: () => void;
  readonly undoTimeline: () => void;
};

const actionHandlers: Readonly<Record<EditorShortcutActionId, (input: TimelineShortcutInput) => void>> = {
  deleteSelection: (input) => input.deleteSelectedClip(),
  playPause: (input) => input.setIsPlaying((current) => !current),
  redo: (input) => input.redoTimeline(),
  resetLayout: (input) => input.resetLayout(),
  splitSelection: (input) => {
    if (input.canSplit) input.splitAtPlayhead();
  },
  toggleInspector: (input) => input.toggleInspector(),
  toggleLeftDock: (input) => input.toggleLeftDock(),
  undo: (input) => input.undoTimeline()
};

export function useTimelineShortcuts(input: TimelineShortcutInput): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (input.isLocked) return;
      if (isTextEditingShortcutTarget(event.target as { tagName?: string; isContentEditable?: boolean } | null)) return;
      const matchedBinding = getEditorShortcutBindings(input.shortcutPreferences).find((binding) => binding.chord !== null && isEditorShortcutEventMatch(event, binding.chord));
      if (matchedBinding === undefined) return;

      if (matchedBinding.actionId !== 'splitSelection' || input.canSplit) {
        event.preventDefault();
        actionHandlers[matchedBinding.actionId](input);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [input]);
}
