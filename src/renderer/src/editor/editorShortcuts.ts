export const EDITOR_SHORTCUT_SCHEMA_VERSION = 1;
export const EDITOR_SHORTCUT_STORAGE_KEY = 'window-loom-editor-shortcuts';

export const EDITOR_SHORTCUT_ACTION_IDS = [
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
] as const;

export type EditorShortcutActionId = (typeof EDITOR_SHORTCUT_ACTION_IDS)[number];

export type EditorShortcutModifier = 'Alt' | 'Ctrl' | 'Meta' | 'Shift';

export type EditorShortcutChord = {
  readonly modifiers: readonly EditorShortcutModifier[];
  readonly key: string;
};

export type EditorShortcutDefinition = {
  readonly actionId: EditorShortcutActionId;
  readonly label: string;
  readonly ariaLabel: string;
  readonly defaultChord: EditorShortcutChord;
  /**
   * Extra chords the default binding also answers to, for keys that differ by
   * keyboard. They apply only while the binding is at its default — a custom
   * chord replaces them — and never take part in conflict detection.
   */
  readonly alternateChords?: readonly EditorShortcutChord[];
};

export type EditorShortcutPreferences = {
  readonly schemaVersion: typeof EDITOR_SHORTCUT_SCHEMA_VERSION;
  readonly overrides: Readonly<Partial<Record<EditorShortcutActionId, EditorShortcutChord | null>>>;
};

export type EditorShortcutBinding = EditorShortcutDefinition & {
  readonly chord: EditorShortcutChord | null;
  readonly isDefault: boolean;
  readonly isEnabled: boolean;
};

export type EditorShortcutConflict = {
  readonly chord: EditorShortcutChord;
  readonly actionIds: readonly EditorShortcutActionId[];
};

export type EditorShortcutPreferenceUpdateResult =
  | { readonly ok: true; readonly preferences: EditorShortcutPreferences }
  | { readonly ok: false; readonly reason: 'conflict'; readonly conflictingActionId: EditorShortcutActionId }
  | { readonly ok: false; readonly reason: 'invalid-chord' | 'reserved-chord' };

type EditorShortcutKeyboardEvent = Pick<KeyboardEvent, 'altKey' | 'ctrlKey' | 'key' | 'metaKey' | 'shiftKey'>;

const MODIFIER_ORDER: readonly EditorShortcutModifier[] = ['Meta', 'Ctrl', 'Alt', 'Shift'];

const MODIFIER_TOKENS: Readonly<Record<string, EditorShortcutModifier>> = {
  alt: 'Alt',
  control: 'Ctrl',
  ctrl: 'Ctrl',
  command: 'Meta',
  cmd: 'Meta',
  meta: 'Meta',
  option: 'Alt',
  shift: 'Shift'
};

const KEY_TOKENS: Readonly<Record<string, string>> = {
  arrowdown: 'ArrowDown',
  arrowleft: 'ArrowLeft',
  arrowright: 'ArrowRight',
  arrowup: 'ArrowUp',
  backspace: 'Backspace',
  down: 'ArrowDown',
  left: 'ArrowLeft',
  right: 'ArrowRight',
  up: 'ArrowUp',
  delete: 'Delete',
  end: 'End',
  enter: 'Enter',
  escape: 'Escape',
  f4: 'F4',
  home: 'Home',
  pageup: 'PageUp',
  pagedown: 'PageDown',
  space: 'Space',
  tab: 'Tab'
};

const RESERVED_EDITOR_SHORTCUT_CHORDS = new Set([
  'Alt+F4',
  'Ctrl+L',
  'Ctrl+N',
  'Ctrl+Q',
  'Ctrl+R',
  'Ctrl+T',
  'Ctrl+W',
  'Meta+L',
  'Meta+N',
  'Meta+Q',
  'Meta+R',
  'Meta+T',
  'Meta+W'
]);

export const EDITOR_SHORTCUT_DEFINITIONS: readonly EditorShortcutDefinition[] = [
  {
    actionId: 'playPause',
    ariaLabel: 'Play or pause playback',
    defaultChord: { key: 'Space', modifiers: [] },
    label: 'Play / pause'
  },
  {
    actionId: 'undo',
    ariaLabel: 'Undo the last editor change',
    defaultChord: { key: 'Z', modifiers: ['Meta'] },
    label: 'Undo'
  },
  {
    actionId: 'redo',
    ariaLabel: 'Redo the last undone editor change',
    defaultChord: { key: 'Z', modifiers: ['Meta', 'Shift'] },
    label: 'Redo'
  },
  {
    actionId: 'deleteSelection',
    ariaLabel: 'Delete the current selection',
    defaultChord: { key: 'Delete', modifiers: [] },
    // The main delete key on Apple keyboards reports Backspace, so binding only
    // Delete left the shortcut dead on a Mac.
    alternateChords: [{ key: 'Backspace', modifiers: [] }],
    label: 'Delete'
  },
  {
    actionId: 'splitSelection',
    ariaLabel: 'Split the selected clip',
    defaultChord: { key: 'S', modifiers: [] },
    label: 'Split'
  },
  {
    actionId: 'selectAll',
    ariaLabel: 'Select every clip on the timeline',
    defaultChord: { key: 'A', modifiers: ['Meta'] },
    label: 'Select all clips'
  },
  {
    actionId: 'clearSelection',
    ariaLabel: 'Clear the current selection',
    defaultChord: { key: 'Escape', modifiers: [] },
    label: 'Clear selection'
  },
  {
    actionId: 'duplicateSelection',
    ariaLabel: 'Duplicate the selected clip',
    defaultChord: { key: 'D', modifiers: ['Meta'] },
    label: 'Duplicate clip'
  },
  {
    actionId: 'saveTimeline',
    ariaLabel: 'Save the timeline to the project folder',
    defaultChord: { key: 'S', modifiers: ['Meta'] },
    label: 'Save timeline'
  },
  {
    actionId: 'stepBackward',
    ariaLabel: 'Move the playhead back one step',
    defaultChord: { key: 'ArrowLeft', modifiers: [] },
    label: 'Step back'
  },
  {
    actionId: 'stepForward',
    ariaLabel: 'Move the playhead forward one step',
    defaultChord: { key: 'ArrowRight', modifiers: [] },
    label: 'Step forward'
  },
  {
    actionId: 'nudgeSelectionLeft',
    ariaLabel: 'Nudge the selected clip earlier',
    defaultChord: { key: 'ArrowLeft', modifiers: ['Alt'] },
    label: 'Nudge clip earlier'
  },
  {
    actionId: 'nudgeSelectionRight',
    ariaLabel: 'Nudge the selected clip later',
    defaultChord: { key: 'ArrowRight', modifiers: ['Alt'] },
    label: 'Nudge clip later'
  },
  {
    actionId: 'goToStart',
    ariaLabel: 'Move the playhead to the start of the timeline',
    defaultChord: { key: 'Home', modifiers: [] },
    label: 'Go to start'
  },
  {
    actionId: 'goToEnd',
    ariaLabel: 'Move the playhead to the end of the timeline',
    defaultChord: { key: 'End', modifiers: [] },
    label: 'Go to end'
  },
  {
    actionId: 'toggleLeftDock',
    ariaLabel: 'Toggle the project and media dock',
    defaultChord: { key: '1', modifiers: ['Meta'] },
    label: 'Toggle project dock'
  },
  {
    actionId: 'toggleInspector',
    ariaLabel: 'Toggle the inspector',
    defaultChord: { key: '2', modifiers: ['Meta'] },
    label: 'Toggle inspector'
  },
  {
    actionId: 'resetLayout',
    ariaLabel: 'Reset the editor layout',
    defaultChord: { key: '0', modifiers: ['Meta'] },
    label: 'Reset layout'
  }
] as const;

export const EDITOR_SHORTCUT_DEFAULT_PREFERENCES: EditorShortcutPreferences = {
  overrides: {},
  schemaVersion: EDITOR_SHORTCUT_SCHEMA_VERSION
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeKeyToken(token: string): string | null {
  const lowered = token.trim().toLowerCase();
  if (lowered.length === 1) return lowered.toUpperCase();
  const namedKey = KEY_TOKENS[lowered];
  if (namedKey !== undefined) return namedKey;
  if (/^f\d{1,2}$/u.test(lowered)) return lowered.toUpperCase();
  return null;
}

function normalizeModifierToken(token: string): EditorShortcutModifier | null {
  return MODIFIER_TOKENS[token.trim().toLowerCase()] ?? null;
}

export function parseEditorShortcutChord(input: string): EditorShortcutChord | null {
  const tokens = input.split('+').map((token) => token.trim()).filter((token) => token.length > 0);
  if (tokens.length === 0) return null;

  const keyToken = tokens.at(-1);
  if (keyToken === undefined) return null;

  const key = normalizeKeyToken(keyToken);
  if (key === null) return null;

  const modifiers = new Set<EditorShortcutModifier>();
  for (const token of tokens.slice(0, -1)) {
    const modifier = normalizeModifierToken(token);
    if (modifier === null) return null;
    modifiers.add(modifier);
  }

  return {
    key,
    modifiers: MODIFIER_ORDER.filter((modifier) => modifiers.has(modifier))
  };
}

export function serializeEditorShortcutChord(chord: EditorShortcutChord): string {
  return [...MODIFIER_ORDER.filter((modifier) => chord.modifiers.includes(modifier)), chord.key].join('+');
}

export function formatEditorShortcutChordForDisplay(chord: EditorShortcutChord): string {
  return serializeEditorShortcutChord(chord);
}

export function formatEditorShortcutChordForAria(chord: EditorShortcutChord): string {
  const modifierLabels: Readonly<Record<EditorShortcutModifier, string>> = {
    Alt: 'Alt',
    Ctrl: 'Control',
    Meta: 'Command',
    Shift: 'Shift'
  };

  return [...chord.modifiers.map((modifier) => modifierLabels[modifier]), chord.key].join(' plus ');
}

export function formatEditorShortcutChordForAriaKeyShortcuts(chord: EditorShortcutChord): string {
  const modifierLabels: Readonly<Record<EditorShortcutModifier, string>> = {
    Alt: 'Alt',
    Ctrl: 'Control',
    Meta: 'Meta',
    Shift: 'Shift'
  };

  return [...chord.modifiers.map((modifier) => modifierLabels[modifier]), chord.key].join('+');
}

export function formatEditorShortcutBindingForDisplay(binding: EditorShortcutBinding): string {
  return binding.chord === null ? `${binding.label} (disabled)` : `${binding.label} (${formatEditorShortcutChordForDisplay(binding.chord)})`;
}

export function formatEditorShortcutBindingForAria(binding: EditorShortcutBinding): string {
  return binding.chord === null ? `${binding.ariaLabel}, shortcut disabled` : `${binding.ariaLabel}, ${formatEditorShortcutChordForAria(binding.chord)}`;
}

export function isReservedEditorShortcutChord(chord: EditorShortcutChord): boolean {
  return RESERVED_EDITOR_SHORTCUT_CHORDS.has(serializeEditorShortcutChord(chord));
}

export function getEditorShortcutBindings(preferences: EditorShortcutPreferences): readonly EditorShortcutBinding[] {
  return EDITOR_SHORTCUT_DEFINITIONS.map((definition) => {
    const hasOverride = Object.prototype.hasOwnProperty.call(preferences.overrides, definition.actionId);
    const override = preferences.overrides[definition.actionId];
    const chord = hasOverride ? (override ?? null) : definition.defaultChord;

    return {
      ...definition,
      chord,
      isDefault: !hasOverride,
      isEnabled: chord !== null
    };
  });
}

export function findEditorShortcutConflicts(bindings: readonly EditorShortcutBinding[]): readonly EditorShortcutConflict[] {
  const byChord = new Map<string, EditorShortcutBinding[]>();

  for (const binding of bindings) {
    if (binding.chord === null) continue;
    const serializedChord = serializeEditorShortcutChord(binding.chord);
    const existingBindings = byChord.get(serializedChord);
    if (existingBindings === undefined) {
      byChord.set(serializedChord, [binding]);
      continue;
    }

    existingBindings.push(binding);
  }

  return [...byChord.values()]
    .filter((conflictedBindings) => conflictedBindings.length > 1)
    .map((conflictedBindings) => ({
      actionIds: conflictedBindings.map((binding) => binding.actionId),
      chord: conflictedBindings[0]!.chord!
    }));
}

function getConflictingEditorShortcutActionId(preferences: EditorShortcutPreferences, actionId: EditorShortcutActionId, chord: EditorShortcutChord): EditorShortcutActionId | null {
  for (const binding of getEditorShortcutBindings(preferences)) {
    if (binding.actionId === actionId || binding.chord === null) continue;
    if (serializeEditorShortcutChord(binding.chord) === serializeEditorShortcutChord(chord)) return binding.actionId;
  }

  return null;
}

function withoutEditorShortcutOverride(preferences: EditorShortcutPreferences, actionId: EditorShortcutActionId): Partial<Record<EditorShortcutActionId, EditorShortcutChord | null>> {
  const overrides: Partial<Record<EditorShortcutActionId, EditorShortcutChord | null>> = { ...preferences.overrides };
  delete overrides[actionId];
  return overrides;
}

export function setEditorShortcutBindingPreference(preferences: EditorShortcutPreferences, actionId: EditorShortcutActionId, chord: EditorShortcutChord | null): EditorShortcutPreferenceUpdateResult {
  if (chord === null) return { ok: true, preferences: disableEditorShortcutBindingPreference(preferences, actionId) };
  if (isReservedEditorShortcutChord(chord)) return { ok: false, reason: 'reserved-chord' };

  const conflictingActionId = getConflictingEditorShortcutActionId(preferences, actionId, chord);
  if (conflictingActionId !== null) return { ok: false, reason: 'conflict', conflictingActionId };

  const definition = EDITOR_SHORTCUT_DEFINITIONS.find((candidate) => candidate.actionId === actionId);
  if (definition === undefined) return { ok: false, reason: 'invalid-chord' };

  const overrides = serializeEditorShortcutChord(definition.defaultChord) === serializeEditorShortcutChord(chord)
    ? withoutEditorShortcutOverride(preferences, actionId)
    : { ...preferences.overrides, [actionId]: chord };

  return {
    ok: true,
    preferences: {
      overrides,
      schemaVersion: EDITOR_SHORTCUT_SCHEMA_VERSION
    }
  };
}

export function disableEditorShortcutBindingPreference(preferences: EditorShortcutPreferences, actionId: EditorShortcutActionId): EditorShortcutPreferences {
  return {
    overrides: { ...preferences.overrides, [actionId]: null },
    schemaVersion: EDITOR_SHORTCUT_SCHEMA_VERSION
  };
}

export function resetEditorShortcutBindingPreference(preferences: EditorShortcutPreferences, actionId: EditorShortcutActionId): EditorShortcutPreferences {
  return {
    overrides: withoutEditorShortcutOverride(preferences, actionId),
    schemaVersion: EDITOR_SHORTCUT_SCHEMA_VERSION
  };
}

/** True when the event fires this binding, including its default alternates. */
export function isEditorShortcutBindingMatch(event: EditorShortcutKeyboardEvent, binding: EditorShortcutBinding): boolean {
  if (!binding.isEnabled || binding.chord === null) return false;
  if (isEditorShortcutEventMatch(event, binding.chord)) return true;
  if (!binding.isDefault) return false;
  return (binding.alternateChords ?? []).some((chord) => isEditorShortcutEventMatch(event, chord));
}

export function isEditorShortcutEventMatch(event: EditorShortcutKeyboardEvent, chord: EditorShortcutChord): boolean {
  const eventKey = normalizeKeyToken(event.key === ' ' ? 'space' : event.key);
  if (eventKey !== chord.key) return false;

  return event.altKey === chord.modifiers.includes('Alt')
    && event.ctrlKey === chord.modifiers.includes('Ctrl')
    && event.metaKey === chord.modifiers.includes('Meta')
    && event.shiftKey === chord.modifiers.includes('Shift');
}

export function parseEditorShortcutPreferences(storedPreferences: string | null | undefined): EditorShortcutPreferences {
  if (storedPreferences === null || storedPreferences === undefined) return EDITOR_SHORTCUT_DEFAULT_PREFERENCES;

  try {
    const parsed: unknown = JSON.parse(storedPreferences);
    if (!isRecord(parsed) || parsed.schemaVersion !== EDITOR_SHORTCUT_SCHEMA_VERSION || !isRecord(parsed.overrides)) {
      return EDITOR_SHORTCUT_DEFAULT_PREFERENCES;
    }

    const overrides: Partial<Record<EditorShortcutActionId, EditorShortcutChord | null>> = {};
    for (const definition of EDITOR_SHORTCUT_DEFINITIONS) {
      const storedChord = parsed.overrides[definition.actionId];
      if (storedChord === null) {
        overrides[definition.actionId] = null;
        continue;
      }
      if (typeof storedChord !== 'string') continue;

      const parsedChord = parseEditorShortcutChord(storedChord);
      if (parsedChord === null || isReservedEditorShortcutChord(parsedChord)) continue;

      overrides[definition.actionId] = parsedChord;
    }

    return {
      overrides,
      schemaVersion: EDITOR_SHORTCUT_SCHEMA_VERSION
    };
  } catch {
    return EDITOR_SHORTCUT_DEFAULT_PREFERENCES;
  }
}

export function serializeEditorShortcutPreferences(preferences: EditorShortcutPreferences): string {
  const overrides: Record<string, string | null> = {};

  for (const definition of EDITOR_SHORTCUT_DEFINITIONS) {
    const chord = preferences.overrides[definition.actionId];
    if (chord === undefined) continue;
    if (chord === null) {
      overrides[definition.actionId] = null;
      continue;
    }

    overrides[definition.actionId] = serializeEditorShortcutChord(chord);
  }

  return JSON.stringify({
    overrides,
    schemaVersion: EDITOR_SHORTCUT_SCHEMA_VERSION
  });
}
