import type { BrowserWindow, IpcMain } from 'electron';

import { IPC_CHANNELS } from '../shared/ipc';
import type { ApiResponse } from '../shared/models';
import type { UpdaterState } from '../shared/updater';
import { fail, ok } from './ipcResponses';
import type { UpdaterController } from './updaterController';

export type UpdaterIpcDependencies = {
  readonly controller: UpdaterController;
  readonly currentVersion: string;
  readonly listWindows: () => readonly BrowserWindow[];
};

export type UpdaterSnapshot = {
  readonly state: UpdaterState;
  readonly currentVersion: string;
};

export function registerUpdaterIpcHandlers(ipcMain: IpcMain, dependencies: UpdaterIpcDependencies): () => void {
  const snapshot = (): UpdaterSnapshot => ({
    state: dependencies.controller.getState(),
    currentVersion: dependencies.currentVersion
  });

  ipcMain.handle(IPC_CHANNELS.updaterGetState, (): ApiResponse<UpdaterSnapshot> => ok(snapshot()));

  ipcMain.handle(IPC_CHANNELS.updaterCheck, async (): Promise<ApiResponse<UpdaterSnapshot>> => {
    await dependencies.controller.check();
    return ok(snapshot());
  });

  ipcMain.handle(IPC_CHANNELS.updaterInstall, async (): Promise<ApiResponse<UpdaterSnapshot>> => {
    try {
      await dependencies.controller.install();
      return ok(snapshot());
    } catch (error: unknown) {
      return fail('UNKNOWN_ERROR', error instanceof Error ? error.message : 'The update could not be installed.');
    }
  });

  // The state moves on the main process's schedule — a download finishing owes
  // the renderer a redraw that no renderer call asked for.
  return dependencies.controller.subscribe((state) => {
    for (const window of dependencies.listWindows()) {
      if (!window.isDestroyed()) {
        window.webContents.send(IPC_CHANNELS.updaterStateChanged, { state, currentVersion: dependencies.currentVersion });
      }
    }
  });
}
