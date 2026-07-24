import type { IpcMain } from 'electron';

import { IPC_CHANNELS } from '../shared/ipc';
import { ResultAssetImportService } from './resultAssetImportService';

export function registerResultAssetImportHandlers(ipcMain: IpcMain, service: ResultAssetImportService): void {
  ipcMain.handle(IPC_CHANNELS.projectRecordingResultImport, (_event, payload: unknown) => service.importRecordingResult(payload));
  ipcMain.handle(IPC_CHANNELS.projectTtsResultImport, (_event, payload: unknown) => service.importTtsResult(payload));
  ipcMain.handle(IPC_CHANNELS.projectAiResultImport, (_event, payload: unknown) => service.importAiResult(payload));
}
