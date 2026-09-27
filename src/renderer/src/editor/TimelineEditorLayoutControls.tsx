import { useEffect, useMemo, useState, type ChangeEvent, type KeyboardEvent, type PointerEvent, type ReactElement } from 'react';

import {
  disableEditorShortcutBindingPreference,
  formatEditorShortcutChordForDisplay,
  getEditorShortcutBindings,
  parseEditorShortcutChord,
  resetEditorShortcutBindingPreference,
  setEditorShortcutBindingPreference,
  type EditorShortcutActionId,
  type EditorShortcutBinding,
  type EditorShortcutPreferences
} from './editorShortcuts';
import {
  EDITOR_LAYOUT_MAX_INSPECTOR_WIDTH,
  EDITOR_LAYOUT_MAX_LEFT_DOCK_WIDTH,
  EDITOR_LAYOUT_MAX_PROGRAM_PERCENT,
  EDITOR_LAYOUT_MIN_INSPECTOR_WIDTH,
  EDITOR_LAYOUT_MIN_LEFT_DOCK_WIDTH,
  EDITOR_LAYOUT_MIN_PROGRAM_PERCENT,
  getNextEditorProgramPercentFromKey,
  getNextEditorSidebarWidthFromKey,
  type EditorInspectorPlacement,
  type EditorSidebarResizeSide
} from './editorLayoutPreferences';

type TimelineShortcutMapProps = {
  readonly shortcutPreferences: EditorShortcutPreferences;
  readonly onShortcutPreferencesChange: (updater: (currentPreference: EditorShortcutPreferences) => EditorShortcutPreferences) => void;
};

type EditorProgramSplitterProps = {
  readonly programPercent: number;
  readonly onProgramPercentChange: (programPercent: number) => void;
};

type EditorLeftDockSplitterProps = {
  readonly leftDockVisible: boolean;
  readonly leftDockWidth: number;
  readonly onLeftDockWidthChange: (leftDockWidth: number) => void;
};

type EditorInspectorSplitterProps = {
  readonly inspectorPlacement: EditorInspectorPlacement;
  readonly inspectorVisible: boolean;
  readonly inspectorWidth: number;
  readonly leftDockVisible: boolean;
  readonly leftDockWidth: number;
  readonly onInspectorWidthChange: (inspectorWidth: number) => void;
};

const SHORTCUT_EMPTY_LABEL = 'Shortcut unavailable';

const SHORTCUT_HINT_BY_REASON: Readonly<Record<'conflict' | 'invalid-chord' | 'reserved-chord', string>> = {
  conflict: 'Shortcut already assigned.',
  'invalid-chord': 'Use a key or modifier + key, for example Meta+Shift+Z.',
  'reserved-chord': 'Shortcut is reserved by the browser or operating system.'
};

function getShortcutValue(binding: EditorShortcutBinding): string {
  return binding.chord === null ? '' : formatEditorShortcutChordForDisplay(binding.chord);
}

function capturePointer(event: PointerEvent<HTMLDivElement>): void {
  event.currentTarget.setPointerCapture(event.pointerId);
}

function releasePointer(event: PointerEvent<HTMLDivElement>): void {
  if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
  event.currentTarget.releasePointerCapture(event.pointerId);
}

export function TimelineShortcutMap({ shortcutPreferences, onShortcutPreferencesChange }: TimelineShortcutMapProps): ReactElement {
  const shortcutBindings = useMemo(() => getEditorShortcutBindings(shortcutPreferences), [shortcutPreferences]);
  const [draftShortcuts, setDraftShortcuts] = useState<Readonly<Record<EditorShortcutActionId, string>>>(() => Object.fromEntries(shortcutBindings.map((binding) => [binding.actionId, getShortcutValue(binding)])) as Readonly<Record<EditorShortcutActionId, string>>);
  const [shortcutMessage, setShortcutMessage] = useState('');

  useEffect(() => {
    setDraftShortcuts(Object.fromEntries(shortcutBindings.map((binding) => [binding.actionId, getShortcutValue(binding)])) as Readonly<Record<EditorShortcutActionId, string>>);
  }, [shortcutBindings]);

  const updateDraftShortcut = (actionId: EditorShortcutActionId, value: string): void => {
    setDraftShortcuts((current) => ({ ...current, [actionId]: value }));
  };

  const applyShortcut = (binding: EditorShortcutBinding): void => {
    const draft = draftShortcuts[binding.actionId].trim();
    const chord = draft.length === 0 ? null : parseEditorShortcutChord(draft);
    if (draft.length > 0 && chord === null) {
      setShortcutMessage(SHORTCUT_HINT_BY_REASON['invalid-chord']);
      return;
    }

    const result = setEditorShortcutBindingPreference(shortcutPreferences, binding.actionId, chord);
    if (!result.ok) {
      setShortcutMessage(result.reason === 'conflict' ? `Shortcut already assigned to ${result.conflictingActionId}.` : SHORTCUT_HINT_BY_REASON[result.reason]);
      return;
    }

    onShortcutPreferencesChange(() => result.preferences);
    setShortcutMessage(chord === null ? `${binding.label} shortcut disabled.` : `${binding.label} shortcut set to ${formatEditorShortcutChordForDisplay(chord)}.`);
  };

  const disableShortcut = (binding: EditorShortcutBinding): void => {
    onShortcutPreferencesChange((currentPreference) => disableEditorShortcutBindingPreference(currentPreference, binding.actionId));
    setShortcutMessage(`${binding.label} shortcut disabled.`);
  };

  const resetShortcut = (binding: EditorShortcutBinding): void => {
    onShortcutPreferencesChange((currentPreference) => resetEditorShortcutBindingPreference(currentPreference, binding.actionId));
    setShortcutMessage(`${binding.label} shortcut reset.`);
  };

  return (
    <details className="shortcut-map">
      <summary>Shortcut map</summary>
      <div className="shortcut-map__grid" aria-label="Editor shortcut bindings">
        {shortcutBindings.map((binding) => (
          <div className="shortcut-row" key={binding.actionId}>
            <label className="shortcut-row__label" htmlFor={`shortcut-input-${binding.actionId}`}>{binding.label}</label>
            <input
              id={`shortcut-input-${binding.actionId}`}
              value={draftShortcuts[binding.actionId]}
              placeholder={SHORTCUT_EMPTY_LABEL}
              aria-label={`${binding.label} shortcut`}
              onChange={(event: ChangeEvent<HTMLInputElement>) => updateDraftShortcut(binding.actionId, event.target.value)}
              onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
                if (event.key !== 'Enter') return;
                event.preventDefault();
                applyShortcut(binding);
              }}
            />
            <button className="button button--ghost shortcut-row__button" type="button" onClick={() => applyShortcut(binding)}>Set shortcut</button>
            <button className="button button--ghost shortcut-row__button" type="button" onClick={() => disableShortcut(binding)}>Disable shortcut</button>
            <button className="button button--ghost shortcut-row__button" type="button" onClick={() => resetShortcut(binding)} disabled={binding.isDefault}>Reset shortcut</button>
          </div>
        ))}
      </div>
      <p className="shortcut-map__status" role="status">{shortcutMessage.length === 0 ? 'Edit a shortcut, press Enter, or use Set shortcut.' : shortcutMessage}</p>
    </details>
  );
}

export function EditorProgramSplitter({ programPercent, onProgramPercentChange }: EditorProgramSplitterProps): ReactElement {
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const nextProgramPercent = getNextEditorProgramPercentFromKey({ currentPercent: programPercent, key: event.key, shiftKey: event.shiftKey });
    if (nextProgramPercent === null) return;
    event.preventDefault();
    onProgramPercentChange(nextProgramPercent);
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>): void => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    const workspaceRect = event.currentTarget.parentElement?.getBoundingClientRect();
    if (workspaceRect === undefined) return;
    const headerBottom = event.currentTarget.parentElement?.querySelector('.oc-editor-host__header')?.getBoundingClientRect().bottom;
    const contentTop = headerBottom ?? workspaceRect.top;
    onProgramPercentChange(((event.clientY - contentTop) / (workspaceRect.bottom - contentTop)) * 100);
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    capturePointer(event);
    onPointerMove(event);
  };

  return (
    <div
      className="editor-program-splitter"
      role="separator"
      tabIndex={0}
      aria-label="Resize program monitor and timeline"
      aria-orientation="horizontal"
      aria-valuemin={EDITOR_LAYOUT_MIN_PROGRAM_PERCENT}
      aria-valuemax={EDITOR_LAYOUT_MAX_PROGRAM_PERCENT}
      aria-valuenow={programPercent}
      aria-valuetext={`Program monitor ${programPercent}%`}
      aria-controls="editor-program-panel editor-timeline-panel"
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={releasePointer}
      onPointerCancel={releasePointer}
    />
  );
}

export function EditorLeftDockSplitter({ leftDockVisible, leftDockWidth, onLeftDockWidthChange }: EditorLeftDockSplitterProps): ReactElement {
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const nextWidth = getNextEditorSidebarWidthFromKey({ currentWidth: leftDockWidth, key: event.key, shiftKey: event.shiftKey, side: 'left-dock' });
    if (nextWidth === null) return;
    event.preventDefault();
    onLeftDockWidthChange(nextWidth);
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>): void => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    const workspaceRect = event.currentTarget.parentElement?.getBoundingClientRect();
    if (workspaceRect === undefined) return;
    onLeftDockWidthChange(event.clientX - workspaceRect.left);
  };

  return (
    <div
      className="editor-left-dock-splitter editor-vertical-splitter"
      role="separator"
      tabIndex={0}
      aria-label="Resize project and media dock"
      aria-orientation="vertical"
      aria-valuemin={EDITOR_LAYOUT_MIN_LEFT_DOCK_WIDTH}
      aria-valuemax={EDITOR_LAYOUT_MAX_LEFT_DOCK_WIDTH}
      aria-valuenow={leftDockWidth}
      aria-valuetext={`Project and media dock ${leftDockWidth} pixels`}
      aria-controls="editor-left-dock-panel editor-program-panel editor-timeline-panel"
      hidden={!leftDockVisible}
      onKeyDown={onKeyDown}
      onPointerDown={capturePointer}
      onPointerMove={onPointerMove}
      onPointerUp={releasePointer}
      onPointerCancel={releasePointer}
    />
  );
}

export function EditorInspectorSplitter({ inspectorPlacement, inspectorVisible, inspectorWidth, leftDockVisible, leftDockWidth, onInspectorWidthChange }: EditorInspectorSplitterProps): ReactElement {
  const side: EditorSidebarResizeSide = inspectorPlacement === 'left' ? 'inspector-left' : 'inspector-right';

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const nextWidth = getNextEditorSidebarWidthFromKey({ currentWidth: inspectorWidth, key: event.key, shiftKey: event.shiftKey, side });
    if (nextWidth === null) return;
    event.preventDefault();
    onInspectorWidthChange(nextWidth);
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>): void => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    const workspaceRect = event.currentTarget.parentElement?.getBoundingClientRect();
    if (workspaceRect === undefined) return;
    const nextWidth = inspectorPlacement === 'left'
      ? event.clientX - workspaceRect.left - (leftDockVisible ? leftDockWidth : 0)
      : workspaceRect.right - event.clientX;
    onInspectorWidthChange(nextWidth);
  };

  return (
    <div
      className="editor-inspector-splitter editor-vertical-splitter"
      role="separator"
      tabIndex={0}
      aria-label="Resize inspector dock"
      aria-orientation="vertical"
      aria-valuemin={EDITOR_LAYOUT_MIN_INSPECTOR_WIDTH}
      aria-valuemax={EDITOR_LAYOUT_MAX_INSPECTOR_WIDTH}
      aria-valuenow={inspectorWidth}
      aria-valuetext={`Inspector dock ${inspectorWidth} pixels`}
      aria-controls="inspector-title editor-program-panel editor-timeline-panel"
      hidden={!inspectorVisible || inspectorPlacement === 'floating'}
      onKeyDown={onKeyDown}
      onPointerDown={capturePointer}
      onPointerMove={onPointerMove}
      onPointerUp={releasePointer}
      onPointerCancel={releasePointer}
    />
  );
}
