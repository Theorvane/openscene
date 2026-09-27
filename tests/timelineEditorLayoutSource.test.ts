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
const OPENCUT_HOST_STYLES_SOURCE_URL = new URL('../external/opencut/apps/web/src/components/editor/editor-workspace-host.css', import.meta.url);

const normalizedSource = (source: string): string => source.replace(/\r\n/g, '\n');

async function readTimelineEditorSource(): Promise<string> {
  const [timelineEditorSource, layoutControlsSource] = await Promise.all([
    readFile(TIMELINE_EDITOR_SOURCE_URL, 'utf8'),
    readFile(TIMELINE_EDITOR_LAYOUT_CONTROLS_SOURCE_URL, 'utf8')
  ]);

  return normalizedSource(`${timelineEditorSource}\n${layoutControlsSource}`);
}

async function readStylesSource(): Promise<string> {
  return normalizedSource(await readFile(STYLES_SOURCE_URL, 'utf8'));
}

async function readOpenCutHostStylesSource(): Promise<string> {
  return normalizedSource(await readFile(OPENCUT_HOST_STYLES_SOURCE_URL, 'utf8'));
}

async function readAppShellSource(): Promise<string> {
  return normalizedSource(await readFile(APP_SHELL_SOURCE_URL, 'utf8'));
}

async function readLayoutPreferenceHookSource(): Promise<string> {
  return normalizedSource(await readFile(LAYOUT_PREFERENCE_HOOK_SOURCE_URL, 'utf8'));
}

async function readNativeMenuCommandsSource(): Promise<string> {
  return normalizedSource(await readFile(NATIVE_MENU_COMMANDS_SOURCE_URL, 'utf8'));
}

async function readShortcutSource(): Promise<string> {
  const [hookSource, shortcutsSource] = await Promise.all([
    readFile(SHORTCUT_PREFERENCE_HOOK_SOURCE_URL, 'utf8'),
    readFile(TIMELINE_SHORTCUTS_SOURCE_URL, 'utf8')
  ]);

  return normalizedSource(`${hookSource}\n${shortcutsSource}`);
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

  it('Given product identity, When the app shell and editor render, Then OpenScene branding belongs to the OpenCut workbench header', async () => {
    const source = await readTimelineEditorSource();
    const appShellSource = await readAppShellSource();

    expect(source).toContain('<strong className="oc-editor-host__brand">OpenScene</strong>');
    expect(source).toContain('className="oc-editor-host__project"');
    expect(source).toContain('<h1 id="timeline-editor-title">OpenScene</h1>');
    expect(source).toContain('<span className="editor-program-region__subtitle">Timeline editor</span>');
    expect(appShellSource).not.toContain('product-chrome__eyebrow');
    expect(appShellSource).not.toContain('<h1 id="app-title">OpenScene</h1>');
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
    const hostStyles = await readOpenCutHostStylesSource();
    const nativeMenuSource = await readNativeMenuCommandsSource();

		expect(source).toContain('oc-editor-host--inspector-${layoutPreference.inspectorPlacement}');
		expect(source).toContain('layoutPreference.inspectorPlacement !== \'floating\'');
		expect(source).toContain('layoutPreference.floatingPanels.inspector.floating');
		expect(nativeMenuSource).toContain('toggleProjectFloating');
		expect(nativeMenuSource).toContain('toggleProgramFloating');
		expect(nativeMenuSource).toContain('toggleInspectorFloating');
		expect(nativeMenuSource).toContain('applyCompactReviewPreset');
		expect(nativeMenuSource).toContain('applyReviewDeckPreset');
		expect(source).toContain('className="editor-floating-layer"');
		expect(source).toContain('aria-label="Floating workspace panels"');
		expect(hostStyles).toContain('.oc-editor-host--inspector-left');
		expect(hostStyles).toContain('.oc-editor-host--inspector-floating');
		expect(styles).toContain('.editor-floating-layer');
		expect(styles).toContain('.editor-floating-panel');
		expect(styles).toContain('.editor-floating-panel__move-controls');
		expect(styles).not.toContain('.editor-floating-inspector');
		expect(styles).not.toContain('window.open');
	});

  it('Given responsive layout CSS, When sidebars are hidden or stacked, Then the desktop splitter is disabled at mobile width', async () => {
    const styles = await readStylesSource();
    const hostStyles = await readOpenCutHostStylesSource();

    expect(hostStyles).toContain('.oc-editor-host--left-hidden');
    expect(hostStyles).toContain('.oc-editor-host--inspector-hidden');
    expect(styles).toContain('#app-workspace-panel-edit {\n  container-type: inline-size;');
    expect(hostStyles).toContain('@container (max-width: 1100px)');
    expect(styles).toContain('.editor-program-splitter');
    expect(styles).toContain('.editor-left-dock-splitter');
    expect(styles).toContain('.editor-inspector-splitter');
    expect(hostStyles).toContain('@media (max-width: 1120px)');
    expect(hostStyles).toContain('.oc-editor-host__program { flex: 0 0 300px; order: 1; }');
    expect(hostStyles).toContain('.oc-editor-host__timeline { flex: 0 0 280px; order: 2; }');
    expect(hostStyles).toContain('.oc-editor-host > .editor-floating-layer { order: 5; }');
    expect(hostStyles).toContain('.oc-editor-host > [role="separator"] { display: none; }');
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
    // Matching goes through the binding, so a disabled binding stays disabled
    // and the default's alternate chords (Backspace for Delete) also fire.
    expect(shortcutSource).toContain('isEditorShortcutBindingMatch');
    expect(shortcutSource).toContain('getEditorShortcutBindings(input.shortcutPreferences)');
    expect(source).not.toContain('ipcRenderer');
    expect(shortcutSource).not.toContain('ipcRenderer');
  });
});
