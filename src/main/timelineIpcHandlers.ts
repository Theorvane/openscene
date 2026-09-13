import type { IpcMain } from 'electron';

import { IPC_CHANNELS } from '../shared/ipc';
import { TimelineIpcService } from './timelineIpcService';

export function registerTimelineIpcHandlers(ipcMain: IpcMain, service: TimelineIpcService): void {
  ipcMain.handle(IPC_CHANNELS.projectsList, (_event, payload: unknown) => service.listProjects(payload));
  ipcMain.handle(IPC_CHANNELS.projectsCreate, (_event, payload: unknown) => service.createProject(payload));
  ipcMain.handle(IPC_CHANNELS.projectsOpen, (_event, payload: unknown) => service.openProject(payload));
  ipcMain.handle(IPC_CHANNELS.projectsOpenFolder, (_event, payload: unknown) => service.openProjectFolder(payload));
  ipcMain.handle(IPC_CHANNELS.projectsDelete, (_event, payload: unknown) => service.deleteProject(payload));
  ipcMain.handle(IPC_CHANNELS.projectAssetsImport, (_event, payload: unknown) => service.importProjectAssets(payload));
  ipcMain.handle(IPC_CHANNELS.projectAssetMetadataUpdate, (_event, payload: unknown) => service.updateAssetMetadata(payload));
  ipcMain.handle(IPC_CHANNELS.projectAssetPlaybackUrl, (_event, payload: unknown) => service.getAssetPlaybackUrl(payload));
  ipcMain.handle(IPC_CHANNELS.projectsRename, (_event, payload: unknown) => service.renameProject(payload));
  ipcMain.handle(IPC_CHANNELS.projectTimelineSave, (_event, payload: unknown) => service.saveTimeline(payload));
  ipcMain.handle(IPC_CHANNELS.projectAiDocumentSave, (_event, payload: unknown) => service.saveAiProjectDocument(payload));
}
