import { describe, expect, it } from 'vitest';

import {
  EDITOR_SHORTCUT_DEFAULT_PREFERENCES,
  EDITOR_SHORTCUT_DEFINITIONS,
  EDITOR_SHORTCUT_SCHEMA_VERSION,
  disableEditorShortcutBindingPreference,
  findEditorShortcutConflicts,
  formatEditorShortcutBindingForAria,
  formatEditorShortcutBindingForDisplay,
  formatEditorShortcutChordForAriaKeyShortcuts,
  formatEditorShortcutChordForAria,
  formatEditorShortcutChordForDisplay,
  getEditorShortcutBindings,
  isEditorShortcutBindingMatch,
  isEditorShortcutEventMatch,
  isReservedEditorShortcutChord,
  parseEditorShortcutChord,
  parseEditorShortcutPreferences,
  resetEditorShortcutBindingPreference,
  setEditorShortcutBindingPreference,
  serializeEditorShortcutPreferences
} from '../src/renderer/src/editor/editorShortcuts';

describe('editor shortcuts', () => {
  it('Given a Mac delete key, When pressed, Then the default Delete binding still fires', () => {
    const bindings = getEditorShortcutBindings(EDITOR_SHORTCUT_DEFAULT_PREFERENCES);
    const deleteBinding = bindings.find((binding) => binding.actionId === 'deleteSelection')!;
    const backspace = { altKey: false, ctrlKey: false, key: 'Backspace', metaKey: false, shiftKey: false };

    // Apple keyboards report the main delete key as Backspace.
    expect(isEditorShortcutBindingMatch(backspace, deleteBinding)).toBe(true);
    expect(isEditorShortcutBindingMatch({ ...backspace, key: 'Delete' }, deleteBinding)).toBe(true);

    // A custom chord replaces the alternates rather than stacking with them.
    const remapped = setEditorShortcutBindingPreference(EDITOR_SHORTCUT_DEFAULT_PREFERENCES, 'deleteSelection', { key: 'X', modifiers: ['Meta'] });
    expect(remapped.ok).toBe(true);
    const custom = getEditorShortcutBindings(remapped.ok ? remapped.preferences : EDITOR_SHORTCUT_DEFAULT_PREFERENCES)
      .find((binding) => binding.actionId === 'deleteSelection')!;
    expect(isEditorShortcutBindingMatch(backspace, custom)).toBe(false);
  });

  it('Given arrow-key bindings, When parsed and pressed, Then they resolve like any other chord', () => {
    // Arrows were unparseable before, so playhead and nudge chords could not exist.
    expect(parseEditorShortcutChord('alt + left')).toEqual({ key: 'ArrowLeft', modifiers: ['Alt'] });
    const bindings = getEditorShortcutBindings(EDITOR_SHORTCUT_DEFAULT_PREFERENCES);
    const stepForward = bindings.find((binding) => binding.actionId === 'stepForward')!;
    const nudgeRight = bindings.find((binding) => binding.actionId === 'nudgeSelectionRight')!;
    const arrowRight = { altKey: false, ctrlKey: false, key: 'ArrowRight', metaKey: false, shiftKey: false };

    expect(isEditorShortcutBindingMatch(arrowRight, stepForward)).toBe(true);
    expect(isEditorShortcutBindingMatch(arrowRight, nudgeRight)).toBe(false);
    expect(isEditorShortcutBindingMatch({ ...arrowRight, altKey: true }, nudgeRight)).toBe(true);
    expect(isEditorShortcutBindingMatch({ ...arrowRight, altKey: true }, stepForward)).toBe(false);
  });

  it('Given the default bindings, When checked for conflicts, Then no two actions share a chord', () => {
    expect(findEditorShortcutConflicts(getEditorShortcutBindings(EDITOR_SHORTCUT_DEFAULT_PREFERENCES))).toEqual([]);
  });

  it('Given a disabled binding, When its chord is pressed, Then nothing matches', () => {
    const preferences = disableEditorShortcutBindingPreference(EDITOR_SHORTCUT_DEFAULT_PREFERENCES, 'selectAll');
    const binding = getEditorShortcutBindings(preferences).find((entry) => entry.actionId === 'selectAll')!;

    expect(binding.isEnabled).toBe(false);
    expect(isEditorShortcutBindingMatch({ altKey: false, ctrlKey: false, key: 'a', metaKey: true, shiftKey: false }, binding)).toBe(false);
  });

  it('Given the select-all default, When Meta+A is pressed, Then it matches', () => {
    const binding = getEditorShortcutBindings(EDITOR_SHORTCUT_DEFAULT_PREFERENCES).find((entry) => entry.actionId === 'selectAll')!;

    expect(binding.chord).toEqual({ key: 'A', modifiers: ['Meta'] });
    expect(isEditorShortcutBindingMatch({ altKey: false, ctrlKey: false, key: 'a', metaKey: true, shiftKey: false }, binding)).toBe(true);
    // Plain "a" must keep typing normally.
    expect(isEditorShortcutBindingMatch({ altKey: false, ctrlKey: false, key: 'a', metaKey: false, shiftKey: false }, binding)).toBe(false);
  });

  it('Given no stored shortcut preferences, When parsed, Then the defaults stay stable', () => {
    expect(parseEditorShortcutPreferences(null)).toEqual(EDITOR_SHORTCUT_DEFAULT_PREFERENCES);
    expect(parseEditorShortcutPreferences(undefined)).toEqual(EDITOR_SHORTCUT_DEFAULT_PREFERENCES);
    expect(EDITOR_SHORTCUT_DEFINITIONS.map((definition) => definition.actionId)).toEqual([
      'playPause',
      'undo',
      'redo',
      'deleteSelection',
      'splitSelection',
      'selectAll',
      'clearSelection',
      'duplicateSelection',
      'saveTimeline',
      'stepBackward',
      'stepForward',
      'nudgeSelectionLeft',
      'nudgeSelectionRight',
      'goToStart',
      'goToEnd',
      'toggleLeftDock',
      'toggleInspector',
      'resetLayout',
    ]);
    expect(EDITOR_SHORTCUT_SCHEMA_VERSION).toBe(1);
  });

  it('Given stored shortcut overrides, When parsed, Then valid chords are normalized and serialized', () => {
    const storedPreferences = JSON.stringify({
      overrides: {
        redo: 'meta + shift + z',
        undo: 'meta + z'
      },
      schemaVersion: 1
    });

    const parsedPreferences = parseEditorShortcutPreferences(storedPreferences);

    expect(serializeEditorShortcutPreferences(parsedPreferences)).toBe(JSON.stringify({
      overrides: {
        undo: 'Meta+Z',
        redo: 'Meta+Shift+Z'
      },
      schemaVersion: 1
    }));
  });

  it('Given a disabled shortcut override, When parsed, Then the action has no active chord or conflict', () => {
    const parsedPreferences = parseEditorShortcutPreferences(JSON.stringify({
      overrides: {
        undo: null,
        redo: 'Meta+Z'
      },
      schemaVersion: 1
    }));

    const bindings = getEditorShortcutBindings(parsedPreferences);
    const undoBinding = bindings.find((candidate) => candidate.actionId === 'undo');

    expect(serializeEditorShortcutPreferences(parsedPreferences)).toBe(JSON.stringify({
      overrides: {
        undo: null,
        redo: 'Meta+Z'
      },
      schemaVersion: 1
    }));
    expect(undoBinding).toMatchObject({ actionId: 'undo', chord: null, isDefault: false, isEnabled: false });
    expect(findEditorShortcutConflicts(bindings)).toEqual([]);
  });

  it('Given a reserved chord, When parsed or inspected, Then it stays blocked from customization', () => {
    const reservedChord = parseEditorShortcutChord('Meta+W');

    expect(reservedChord).not.toBeNull();
    expect(reservedChord === null ? false : isReservedEditorShortcutChord(reservedChord)).toBe(true);
    expect(parseEditorShortcutPreferences(JSON.stringify({
      overrides: {
        undo: 'Meta+W'
      },
      schemaVersion: 1
    }))).toEqual(EDITOR_SHORTCUT_DEFAULT_PREFERENCES);
  });

  it('Given conflicting bindings, When compared, Then the conflict report lists every action sharing a chord', () => {
    const preferences = parseEditorShortcutPreferences(JSON.stringify({
      overrides: {
        redo: 'Meta+Z'
      },
      schemaVersion: 1
    }));

    const conflicts = findEditorShortcutConflicts(getEditorShortcutBindings(preferences));

    expect(conflicts).toEqual([
      {
        actionIds: ['undo', 'redo'],
        chord: { key: 'Z', modifiers: ['Meta'] }
      }
    ]);
  });

  it('Given shortcut preference edits, When remapping, disabling, or resetting, Then reserved and conflicting chords are rejected', () => {
    const reserved = parseEditorShortcutChord('Meta+W');
    const conflict = parseEditorShortcutChord('Meta+Z');
    const remap = parseEditorShortcutChord('Ctrl+U');

    expect(reserved).not.toBeNull();
    expect(conflict).not.toBeNull();
    expect(remap).not.toBeNull();

    const reservedResult = reserved === null
      ? null
      : setEditorShortcutBindingPreference(EDITOR_SHORTCUT_DEFAULT_PREFERENCES, 'undo', reserved);
    const conflictResult = conflict === null
      ? null
      : setEditorShortcutBindingPreference(EDITOR_SHORTCUT_DEFAULT_PREFERENCES, 'redo', conflict);
    const remapResult = remap === null
      ? null
      : setEditorShortcutBindingPreference(EDITOR_SHORTCUT_DEFAULT_PREFERENCES, 'undo', remap);

    expect(reservedResult).toEqual({ ok: false, reason: 'reserved-chord' });
    expect(conflictResult).toEqual({ ok: false, reason: 'conflict', conflictingActionId: 'undo' });
    expect(remapResult).toMatchObject({ ok: true, preferences: { overrides: { undo: { key: 'U', modifiers: ['Ctrl'] } } } });

    const disabled = disableEditorShortcutBindingPreference(EDITOR_SHORTCUT_DEFAULT_PREFERENCES, 'undo');
    expect(disabled.overrides.undo).toBeNull();
    expect(resetEditorShortcutBindingPreference(disabled, 'undo')).toEqual(EDITOR_SHORTCUT_DEFAULT_PREFERENCES);
  });

  it('Given a keyboard event, When compared with a binding chord, Then exact key and modifier matches trigger actions', () => {
    const chord = parseEditorShortcutChord('Meta+Shift+Z');

    expect(chord).not.toBeNull();
    expect(chord === null ? false : isEditorShortcutEventMatch({ altKey: false, ctrlKey: false, key: 'z', metaKey: true, shiftKey: true }, chord)).toBe(true);
    expect(chord === null ? false : isEditorShortcutEventMatch({ altKey: false, ctrlKey: true, key: 'z', metaKey: true, shiftKey: true }, chord)).toBe(false);
    expect(parseEditorShortcutChord('Space')).toMatchObject({ key: 'Space', modifiers: [] });
  });

  it('Given chord and binding formatters, When rendered, Then display and aria strings stay human-readable', () => {
    const chord = parseEditorShortcutChord('Ctrl+Shift+Z');
    const binding = getEditorShortcutBindings(parseEditorShortcutPreferences(null)).find((candidate) => candidate.actionId === 'undo');

    expect(chord).not.toBeNull();
    expect(chord === null ? '' : formatEditorShortcutChordForDisplay(chord)).toBe('Ctrl+Shift+Z');
    expect(chord === null ? '' : formatEditorShortcutChordForAriaKeyShortcuts(chord)).toBe('Control+Shift+Z');
    expect(chord === null ? '' : formatEditorShortcutChordForAria(chord)).toBe('Control plus Shift plus Z');
    expect(binding === undefined ? '' : formatEditorShortcutBindingForDisplay(binding)).toBe('Undo (Meta+Z)');
    expect(binding === undefined ? '' : formatEditorShortcutBindingForAria(binding)).toBe('Undo the last editor change, Command plus Z');
  });
});
