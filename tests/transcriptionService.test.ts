import { mkdtemp, open, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { TranscriptionService } from '../src/main/transcriptionService';
import type { MediaAsset } from '../src/shared/timelineTypes';

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });

async function sourceFixture() {
  const directory = await mkdtemp(join(tmpdir(), 'openscene-transcription-service-'));
  directories.push(directory);
  const filePath = join(directory, 'voice.wav');
  await writeFile(filePath, Buffer.from([1, 2, 3]));
  return { directory, filePath };
}

const asset: MediaAsset = {
  id: 'audio-1', displayName: 'voice.wav', projectRelativePath: 'assets/voice.wav', kind: 'audio', mimeType: 'audio/wav', byteLength: 3,
  metadata: { durationMs: 2_000 }, createdAt: '2026-09-06T00:00:00.000Z', updatedAt: '2026-09-06T00:00:00.000Z'
};
const runtime = { executablePath: 'whisper-cli', modelPath: 'model.bin', executableName: 'whisper-cli', modelName: 'model.bin', version: 'test', checksumVerified: true };

describe('TranscriptionService', () => {
  it('reaches completed with a path-free review draft', async () => {
    const fixture = await sourceFixture();
    const service = new TranscriptionService({
      getAsset: async () => asset,
      openAsset: async () => ({ file: await open(fixture.filePath, 'r'), filePath: fixture.filePath, mimeType: asset.mimeType, byteLength: 3 }),
      discoverFfmpeg: async () => ({ kind: 'system', executablePath: 'ffmpeg' }),
      resolveRuntime: async () => ({ status: { ready: true, checksumVerified: true }, runtime }),
      transcribe: async ({ onStage, onProgress }) => {
        onStage('normalizing'); onProgress(20); onStage('transcribing'); onProgress(90);
        return [{ id: 'transcript-cue-1', text: 'Ready.', startMs: 0, endMs: 1_000 }];
      }
    });
    const started = await service.start({ projectId: 'project-1', assetId: 'audio-1', language: 'en' });
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    await vi.waitFor(() => expect(service.get(started.value.id)?.status).toBe('completed'));
    const completed = service.get(started.value.id)!;
    expect(completed.draft?.cues[0]?.text).toBe('Ready.');
    expect(JSON.stringify(completed)).not.toContain(fixture.directory);
  });

  it('cancels an active process into a terminal state', async () => {
    const fixture = await sourceFixture();
    const service = new TranscriptionService({
      getAsset: async () => asset,
      openAsset: async () => ({ file: await open(fixture.filePath, 'r'), filePath: fixture.filePath, mimeType: asset.mimeType, byteLength: 3 }),
      discoverFfmpeg: async () => ({ kind: 'system', executablePath: 'ffmpeg' }),
      resolveRuntime: async () => ({ status: { ready: true, checksumVerified: true }, runtime }),
      transcribe: async ({ signal, onStage }) => {
        onStage('transcribing');
        await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }));
        throw new Error('cancelled');
      }
    });
    const started = await service.start({ projectId: 'project-1', assetId: 'audio-1', language: 'auto' });
    if (!started.ok) throw new Error('start failed');
    await vi.waitFor(() => expect(service.get(started.value.id)?.status).toBe('transcribing'));
    expect(service.cancel(started.value.id)).toEqual({ ok: true, value: { cancelled: true } });
    await vi.waitFor(() => expect(service.get(started.value.id)?.status).toBe('cancelled'));
  });

  it('reports missing runtime as a failed terminal job', async () => {
    const service = new TranscriptionService({
      getAsset: async () => asset,
      openAsset: async () => null,
      discoverFfmpeg: async () => ({ kind: 'system', executablePath: 'ffmpeg' }),
      resolveRuntime: async () => ({ status: { ready: false, checksumVerified: false, reason: 'Configure Whisper.' } })
    });
    const started = await service.start({ projectId: 'project-1', assetId: 'audio-1', language: 'vi' });
    if (!started.ok) throw new Error('start failed');
    await vi.waitFor(() => expect(service.get(started.value.id)?.status).toBe('failed'));
    expect(service.get(started.value.id)?.error).toBe('Configure Whisper.');
  });
});
