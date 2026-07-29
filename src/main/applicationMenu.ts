import { BrowserWindow, ipcMain, Menu } from 'electron';
import type { MenuItemConstructorOptions } from 'electron';

import { IPC_CHANNELS } from '../shared/ipc';
import {
  TIMELINE_MENU_COMMAND_IDS,
  parseTimelineMenuState,
  type TimelineMenuCommandId,
  type TimelineMenuState
} from '../shared/timelineMenuCommands';

type TimelineMenuItemTarget = {
  checked: boolean;
  enabled: boolean;
  label: string;
};

type TimelineMenuTarget = {
  readonly getMenuItemById: (id: string) => TimelineMenuItemTarget | null;
};

type FocusedWindowTarget = {
  readonly webContents: {
    readonly send: (channel: string, commandId: TimelineMenuCommandId) => void;
  };
};

type GetFocusedWindow = () => FocusedWindowTarget | null;
type SendTimelineMenuCommand = (commandId: TimelineMenuCommandId) => void;

export function getTimelineMenuItemId(commandId: TimelineMenuCommandId): string {
  return `timeline:${commandId}`;
}

export function dispatchTimelineMenuCommand(
  commandId: TimelineMenuCommandId,
  getFocusedWindow: GetFocusedWindow = () => BrowserWindow.getFocusedWindow()
): void {
  getFocusedWindow()?.webContents.send(IPC_CHANNELS.timelineMenuCommand, commandId);
}

function createCommandItemFactory(onCommand: SendTimelineMenuCommand) {
  return (
    commandId: TimelineMenuCommandId,
    label: string,
    type: 'checkbox' | 'normal' | 'radio' = 'normal'
  ): MenuItemConstructorOptions => ({
    id: getTimelineMenuItemId(commandId),
    label,
    type,
    checked: false,
    enabled: false,
    click: () => onCommand(commandId)
  });
}

export function createApplicationMenuTemplate(onCommand: SendTimelineMenuCommand): MenuItemConstructorOptions[] {
  const commandItem = createCommandItemFactory(onCommand);
  const template: MenuItemConstructorOptions[] = [];
  // macOS always titles the first menu with the running bundle's name, so the
  // label is what a packaged OpenVideo build shows; a dev run reads Electron.
  if (process.platform === 'darwin') template.push({ label: 'OpenVideo', role: 'appMenu' });
  template.push(
    { role: 'fileMenu' },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    {
      label: 'Timeline',
      submenu: [
        commandItem('playPause', 'Play'),
        commandItem('rewind', 'Rewind'),
        { type: 'separator' },
        commandItem('undo', 'Undo'),
        commandItem('redo', 'Redo'),
        commandItem('splitAtPlayhead', 'Split at playhead'),
        { type: 'separator' },
        {
          label: 'Add Track',
          submenu: [
            commandItem('addVideoTrack', 'Video Track'),
            commandItem('addAudioTrack', 'Audio Track')
          ]
        },
        {
          label: 'Layout',
          submenu: [
            commandItem('toggleLeftDock', 'Project Dock', 'checkbox'),
            commandItem('toggleInspector', 'Inspector', 'checkbox'),
            {
              label: 'Inspector Placement',
              submenu: [
                commandItem('setInspectorLeft', 'Left', 'radio'),
                commandItem('setInspectorRight', 'Right', 'radio'),
                commandItem('setInspectorFloating', 'Float', 'radio')
              ]
            },
            {
              label: 'Floating Panels',
              submenu: [
                commandItem('toggleProjectFloating', 'Project', 'checkbox'),
                commandItem('toggleProgramFloating', 'Program', 'checkbox'),
                commandItem('toggleInspectorFloating', 'Inspector', 'checkbox'),
                commandItem('toggleExportFloating', 'Export', 'checkbox')
              ]
            },
            {
              label: 'Presets',
              submenu: [
                commandItem('applyCompactReviewPreset', 'Compact review'),
                commandItem('applyReviewDeckPreset', 'Review deck')
              ]
            },
            { type: 'separator' },
            commandItem('resetLayout', 'Reset Layout')
          ]
        },
        { type: 'separator' },
        commandItem('saveTimeline', 'Save Timeline')
      ]
    },
    { role: 'windowMenu' }
  );
  return template;
}

export function applyTimelineMenuState(menu: TimelineMenuTarget, state: TimelineMenuState): void {
  for (const commandId of TIMELINE_MENU_COMMAND_IDS) {
    const item = menu.getMenuItemById(getTimelineMenuItemId(commandId));
    if (item === null) continue;
    item.enabled = state.commands[commandId].enabled;
    item.checked = state.commands[commandId].checked;
  }
  const playPauseItem = menu.getMenuItemById(getTimelineMenuItemId('playPause'));
  if (playPauseItem !== null) playPauseItem.label = state.playPauseLabel;
}

export function installApplicationMenu(): void {
  const menu = Menu.buildFromTemplate(createApplicationMenuTemplate(dispatchTimelineMenuCommand));
  Menu.setApplicationMenu(menu);
  ipcMain.on(IPC_CHANNELS.timelineMenuState, (event, payload: unknown) => {
    const focusedWindow = BrowserWindow.getFocusedWindow();
    if (focusedWindow === null || focusedWindow.webContents !== event.sender) return;
    const state = parseTimelineMenuState(payload);
    if (state === null) return;
    applyTimelineMenuState(menu, state);
  });
}
