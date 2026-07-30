import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

const PRELOAD_SOURCE_URL = new URL('../src/preload/index.ts', import.meta.url);
const RENDERER_HOOK_SOURCE_URL = new URL('../src/renderer/src/editor/useEditorNativeMenuCommands.ts', import.meta.url);
const TIMELINE_EDITOR_SOURCE_URL = new URL('../src/renderer/src/editor/TimelineEditor.tsx', import.meta.url);
const MAIN_MENU_SOURCE_URL = new URL('../src/main/applicationMenu.ts', import.meta.url);
const MAIN_INDEX_SOURCE_URL = new URL('../src/main/index.ts', import.meta.url);

describe('native Timeline menu source boundaries', () => {
  it('Given the preload bridge, When exposing menu events, Then it hides Electron events and returns subscription cleanup', async () => {
    const source = await readFile(PRELOAD_SOURCE_URL, 'utf8');

    expect(source).toContain('onTimelineMenuCommand');
    expect(source).toContain('updateTimelineMenuState');
    expect(source).toContain('ipcRenderer.removeListener');
    expect(source).not.toContain('event: Electron.IpcRendererEvent');
  });

  it('Given renderer menu integration, When commands and state cross process boundaries, Then only the typed preload API is used', async () => {
    const [source, timelineEditorSource] = await Promise.all([
      readFile(RENDERER_HOOK_SOURCE_URL, 'utf8'),
      readFile(TIMELINE_EDITOR_SOURCE_URL, 'utf8')
    ]);

    expect(source).toContain('window.videoTool.onTimelineMenuCommand');
    expect(source).toContain('window.videoTool.updateTimelineMenuState');
    expect(timelineEditorSource).toContain('useEditorNativeMenuCommands({');
    expect(source).not.toContain('ipcRenderer');
  });

  it('Given main menu integration, When installed and updated, Then Electron Menu APIs and focused-window routing are used', async () => {
    const [source, mainIndexSource] = await Promise.all([
      readFile(MAIN_MENU_SOURCE_URL, 'utf8'),
      readFile(MAIN_INDEX_SOURCE_URL, 'utf8')
    ]);

    expect(source).toContain('Menu.buildFromTemplate');
    expect(source).toContain('Menu.setApplicationMenu');
    expect(source).toContain('BrowserWindow.getFocusedWindow');
    expect(source).toContain('webContents.send');
    expect(source).toContain('focusedWindow.webContents !== event.sender');
    // Installed from the main entry, now with the check-for-updates handler it
    // needs to offer that item at all.
    expect(mainIndexSource).toContain('installApplicationMenu(');
    expect(mainIndexSource).toMatch(/installApplicationMenu\(\(\) => \{/);
    expect(source).not.toContain('executeJavaScript');
  });
});
