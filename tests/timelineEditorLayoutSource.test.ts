import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

const TIMELINE_EDITOR_SOURCE_URL = new URL('../src/renderer/src/editor/TimelineEditor.tsx', import.meta.url);
const TIMELINE_EDITOR_LAYOUT_CONTROLS_SOURCE_URL = new URL('../src/renderer/src/editor/TimelineEditorLayoutControls.tsx', import.meta.url);
const APP_SHELL_SOURCE_URL = new URL('../src/renderer/src/AppShell.tsx', import.meta.url);
const LAYOUT_PREFERENCE_HOOK_SOURCE_URL = new URL('../src/renderer/src/editor/useEditorLayoutPreference.ts', import.meta.url);
const NATIVE_MENU_COMMANDS_SOURCE_URL = new URL('../src/renderer/src/editor/useEditorNativeMenuCommands.ts', import.meta.url);
const SHORTCUT_PREFERENCE_HOOK_SOURCE_URL = new URL('../src/renderer/src/editor/useEditorShortcutPreference.ts', import.meta.url);
const TIMELINE_SHORTCUTS_SOURCE_URL = new URL('../src/renderer/src/editor/useTimelineShortcuts.ts', import.meta.url);
const STYLES_SOURCE_URL = new URL('../src/renderer/src/styles.css', import.meta.url);

async function readTimelineEditorSource(): Promise<string> {
  const [timelineEditorSource, layoutControlsSource] = await Promise.all([
    readFile(TIMELINE_EDITOR_SOURCE_URL, 'utf8'),
    readFile(TIMELINE_EDITOR_LAYOUT_CONTROLS_SOURCE_URL, 'utf8')
  ]);

  return `${timelineEditorSource}\n${layoutControlsSource}`;
}

async function readStylesSource(): Promise<string> {
  return readFile(STYLES_SOURCE_URL, 'utf8');
}

async function readAppShellSource(): Promise<string> {
  return readFile(APP_SHELL_SOURCE_URL, 'utf8');
}

async function readLayoutPreferenceHookSource(): Promise<string> {
  return readFile(LAYOUT_PREFERENCE_HOOK_SOURCE_URL, 'utf8');
}

async function readNativeMenuCommandsSource(): Promise<string> {
  return readFile(NATIVE_MENU_COMMANDS_SOURCE_URL, 'utf8');
}

async function readShortcutSource(): Promise<string> {
  const [hookSource, shortcutsSource] = await Promise.all([
    readFile(SHORTCUT_PREFERENCE_HOOK_SOURCE_URL, 'utf8'),
    readFile(TIMELINE_SHORTCUTS_SOURCE_URL, 'utf8')
  ]);

  return `${hookSource}\n${shortcutsSource}`;
}

describe('timeline editor layout source contract', () => {
  it('Given layout controls, When rendered, Then native menu commands own layout actions without IPC', async () => {
    const source = await readTimelineEditorSource();
    const hookSource = await readLayoutPreferenceHookSource();

    expect(source).toContain('useEditorLayoutPreference');
    expect(source).toContain('useEditorNativeMenuCommands');
    expect(hookSource).toContain('EDITOR_LAYOUT_STORAGE_KEY');
    expect(hookSource).toContain('parseEditorLayoutPreference');
    expect(hookSource).toContain('serializeEditorLayoutPreference');
    expect(source).toContain('onSetInspectorPlacement: setInspectorPlacement');
    expect(source).toContain('onSetFloatingPanelMode: setFloatingPanelMode');
    expect(source).toContain('onResetLayout: resetLayout');
    expect(source).not.toContain('TimelineCommandBar');
    expect(source).not.toContain('role="toolbar" aria-label="Timeline commands"');
    expect(source).not.toContain('ipcRenderer');
    expect(hookSource).not.toContain('ipcRenderer');
  });

  it('Given product identity, When the app shell and editor render, Then OpenVideo branding belongs to the program header', async () => {
    const source = await readTimelineEditorSource();
    const appShellSource = await readAppShellSource();

    expect(source).toContain('<p className="section-kicker">Local studio</p>');
    expect(source).toContain('<h1 id="timeline-editor-title">OpenVideo</h1>');
    expect(source).toContain('<span className="editor-program-region__subtitle">Timeline editor</span>');
    expect(appShellSource).not.toContain('product-chrome__eyebrow');
    expect(appShellSource).not.toContain('<h1 id="app-title">OpenVideo</h1>');
    expect(appShellSource).toContain('aria-label="Application chrome"');
  });

  it('Given the program splitter, When rendered, Then it has the desktop separator accessibility contract', async () => {
    const source = await readTimelineEditorSource();

    expect(source).toContain('role="separator"');
    expect(source).toContain('aria-orientation="horizontal"');
    expect(source).toContain('aria-valuemin={EDITOR_LAYOUT_MIN_PROGRAM_PERCENT}');
    expect(source).toContain('aria-valuemax={EDITOR_LAYOUT_MAX_PROGRAM_PERCENT}');
    expect(source).toContain('aria-valuenow={programPercent}');
    expect(source).toContain('aria-controls="editor-program-panel editor-timeline-panel"');
    expect(source).toContain('getNextEditorProgramPercentFromKey');
  });

  it('Given the dock splitters, When rendered, Then they expose vertical separator accessibility and persisted width text', async () => {
    const source = await readTimelineEditorSource();

    expect(source).toContain('className="editor-left-dock-splitter editor-vertical-splitter"');
    expect(source).toContain('className="editor-inspector-splitter editor-vertical-splitter"');
    expect(source).toContain('aria-orientation="vertical"');
    expect(source).toContain('aria-valuemin={EDITOR_LAYOUT_MIN_LEFT_DOCK_WIDTH}');
    expect(source).toContain('aria-valuemax={EDITOR_LAYOUT_MAX_LEFT_DOCK_WIDTH}');
    expect(source).toContain('aria-valuenow={leftDockWidth}');
    expect(source).toContain('Project and media dock ${leftDockWidth} pixels');
    expect(source).toContain('aria-valuemin={EDITOR_LAYOUT_MIN_INSPECTOR_WIDTH}');
    expect(source).toContain('aria-valuemax={EDITOR_LAYOUT_MAX_INSPECTOR_WIDTH}');
    expect(source).toContain('aria-valuenow={inspectorWidth}');
    expect(source).toContain('Inspector dock ${inspectorWidth} pixels');
    expect(source).toContain('getNextEditorSidebarWidthFromKey');
  });

  it('Given inspector placement modes, When rendered, Then the inspector can dock left, dock right, or float in-app', async () => {
    const source = await readTimelineEditorSource();
    const styles = await readStylesSource();
    const nativeMenuSource = await readNativeMenuCommandsSource();

		expect(source).toContain('editor-workspace--inspector-${layoutPreference.inspectorPlacement}');
		expect(source).toContain('layoutPreference.inspectorPlacement !== \'floating\'');
		expect(source).toContain('layoutPreference.floatingPanels.inspector.floating');
		expect(nativeMenuSource).toContain('toggleProjectFloating');
		expect(nativeMenuSource).toContain('toggleProgramFloating');
		expect(nativeMenuSource).toContain('toggleInspectorFloating');
		expect(nativeMenuSource).toContain('applyCompactReviewPreset');
		expect(nativeMenuSource).toContain('applyReviewDeckPreset');
		expect(source).toContain('className="editor-floating-layer"');
		expect(source).toContain('aria-label="Floating workspace panels"');
		expect(styles).toContain('.editor-workspace--inspector-left');
		expect(styles).toContain('.editor-workspace--inspector-floating');
		expect(styles).toContain('.editor-floating-layer');
		expect(styles).toContain('.editor-floating-panel');
		expect(styles).toContain('.editor-floating-panel__move-controls');
		expect(styles).not.toContain('.editor-floating-inspector');
		expect(styles).not.toContain('window.open');
	});

  it('Given responsive layout CSS, When sidebars are hidden or stacked, Then the desktop splitter is disabled at mobile width', async () => {
    const styles = await readStylesSource();

    expect(styles).toContain('.editor-workspace--left-dock-hidden');
    expect(styles).toContain('.editor-workspace--inspector-hidden');
    expect(styles).toContain('.editor-program-splitter');
    expect(styles).toContain('.editor-left-dock-splitter');
    expect(styles).toContain('.editor-inspector-splitter');
    expect(styles).toContain('@media (max-width: 1120px)');
    expect(styles).toContain('"program"\n      "timeline"\n      "project"\n      "inspector"');
    expect(styles).not.toContain('grid-area: command;');
    expect(styles).toContain('.editor-program-splitter {');
    expect(styles).toContain('display: none;');
    expect(styles).toContain('position: static;');
  });

  it('Given configurable editor shortcuts, When rendered, Then Settings exposes remap controls and the editor consumes stored preferences without IPC', async () => {
    const source = await readTimelineEditorSource();
    const shortcutSource = await readShortcutSource();
    const settingsSource = await readFile(new URL('../src/renderer/src/SettingsWorkspace.tsx', import.meta.url), 'utf8');

    expect(source).toContain('useEditorShortcutPreference');
    expect(source).toContain('TimelineShortcutMap');
    expect(source).toContain('className="shortcut-map__status" role="status"');
    expect(source).toContain('shortcut-input-${binding.actionId}');
    expect(source).toContain('Disable shortcut');
    expect(source).toContain('Reset shortcut');
    expect(source).toContain('Shortcut unavailable');
    expect(source).not.toContain('<TimelineShortcutMap');
    expect(settingsSource).toContain('<TimelineShortcutMap shortcutPreferences={shortcutPreferences} onShortcutPreferencesChange={updateShortcutPreferences} />');
    expect(settingsSource).toContain("id: 'shortcuts'");
    expect(source).not.toContain('Timeline commands');
    expect(source).not.toContain('Split at playhead</button>');
    expect(shortcutSource).toContain('EDITOR_SHORTCUT_STORAGE_KEY');
    expect(shortcutSource).toContain('isEditorShortcutEventMatch');
    expect(shortcutSource).toContain('getEditorShortcutBindings(input.shortcutPreferences)');
    expect(source).not.toContain('ipcRenderer');
    expect(shortcutSource).not.toContain('ipcRenderer');
  });
});
