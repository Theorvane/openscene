import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

async function readRepo(path: string): Promise<string> { return readFile(new URL(`../${path}`, import.meta.url), 'utf8'); }

describe('automatic subtitle surface parity', () => {
  it('wires desktop through typed IPC and keeps the mobile runtime boundary visible', async () => {
    const [ipc, preload, handlers, main, desktop, mobile] = await Promise.all([
      readRepo('src/shared/ipc.ts'), readRepo('src/preload/index.ts'), readRepo('src/main/transcriptionIpcHandlers.ts'),
      readRepo('src/main/index.ts'), readRepo('src/renderer/src/TranscriptionPanel.tsx'), readRepo('mobile/src/screens/VoiceScreen.tsx')
    ]);
    expect(ipc).toContain("transcriptionStart: 'transcription:start'");
    expect(preload).toContain('startTranscription(input: StartTranscriptionInput)');
    expect(handlers).toContain('service.start(payload)');
    expect(main).toContain('registerTranscriptionIpcHandlers(ipcMain, transcriptionService)');
    expect(desktop).toContain('Transcribe selected asset');
    expect(mobile).toContain('Local whisper.cpp transcription runs on desktop');
    expect(mobile).toContain('applyTranscriptionCues');
  });
});
