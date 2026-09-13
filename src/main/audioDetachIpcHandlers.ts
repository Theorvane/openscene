import type { IpcMain } from 'electron';

import { IPC_CHANNELS } from '../shared/ipc';
import type { AudioDetachService } from './audioDetachService';

export function registerAudioDetachIpcHandler(ipcMain: IpcMain, service: AudioDetachService): void {
  ipcMain.handle(IPC_CHANNELS.projectAssetDetachAudio, (_event, payload: unknown) => service.detach(payload));
}
