import type { IpcMain } from 'electron';

import { IPC_CHANNELS } from '../shared/ipc';
import { ExportIpcService } from './exportIpcService';

export function registerExportIpcHandlers(ipcMain: IpcMain, service: ExportIpcService): void {
  ipcMain.handle(IPC_CHANNELS.getFfmpegRuntimeStatus, () => service.getFfmpegRuntimeStatus());
  ipcMain.handle(IPC_CHANNELS.startExportJob, (_event, payload: unknown) => service.startExportJob(payload));
  ipcMain.handle(IPC_CHANNELS.getExportJob, (_event, payload: unknown) => service.getExportJob(payload));
  ipcMain.handle(IPC_CHANNELS.cancelExportJob, (_event, payload: unknown) => service.cancelExportJob(payload));
  ipcMain.handle(IPC_CHANNELS.openExportResult, (_event, payload: unknown) => service.openExportResult(payload));
  ipcMain.handle(IPC_CHANNELS.revealExportResult, (_event, payload: unknown) => service.revealExportResult(payload));
}
