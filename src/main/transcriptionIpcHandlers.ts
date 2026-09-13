import type { IpcMain } from 'electron';

import { IPC_CHANNELS } from '../shared/ipc';
import { fail, ok } from './ipcResponses';
import type { TranscriptionService } from './transcriptionService';

export function registerTranscriptionIpcHandlers(ipcMain: IpcMain, service: TranscriptionService): void {
  ipcMain.handle(IPC_CHANNELS.transcriptionRuntimeStatus, async () => ok(await service.runtimeStatus()));
  ipcMain.handle(IPC_CHANNELS.transcriptionStart, (_event, payload: unknown) => service.start(payload));
  ipcMain.handle(IPC_CHANNELS.transcriptionGetJob, (_event, jobId: unknown) => {
    if (typeof jobId !== 'string' || !jobId) return fail('INVALID_INPUT', 'A transcription job id is required.');
    const job = service.get(jobId);
    return job === null ? fail('JOB_NOT_FOUND', 'Transcription job was not found.') : ok(job);
  });
  ipcMain.handle(IPC_CHANNELS.transcriptionCancelJob, (_event, jobId: unknown) =>
    typeof jobId !== 'string' || !jobId
      ? fail('INVALID_INPUT', 'A transcription job id is required.')
      : service.cancel(jobId));
}
