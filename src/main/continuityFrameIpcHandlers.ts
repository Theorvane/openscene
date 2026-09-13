import type { IpcMain } from 'electron';

import { IPC_CHANNELS } from '../shared/ipc';
import type { ContinuityFrameService } from './continuityFrameService';

export function registerContinuityFrameIpcHandlers(ipcMain: IpcMain, service: ContinuityFrameService): void {
  ipcMain.handle(IPC_CHANNELS.aiExtractContinuationFrame, (_event, payload: unknown) => service.extract(payload));
  ipcMain.handle(IPC_CHANNELS.aiGetProjectImageReference, (_event, payload: unknown) => service.getReference(payload));
}
