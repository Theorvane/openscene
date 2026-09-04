import { mkdtemp, open, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { ExportIpcService } from '../src/main/exportIpcService';
import { ExportJobStore } from '../src/main/exportJobStore';
import type { FfmpegExecution, StartFfmpegExportProcessInput } from '../src/main/ffmpegExportProcess';
import { DEFAULT_CLIP_EFFECTS, PROJECT_SCHEMA_VERSION, TIMELINE_SCHEMA_VERSION } from '../src/shared/timelineTypes';
import type { LocalProjectSnapshot } from '../src/shared/timelineTypes';
import { createEmptyAiProjectDocument } from '../src/shared/aiProjectDomain';

const SNAPSHOT: LocalProjectSnapshot = {
  schemaVersion: PROJECT_SCHEMA_VERSION,
  id: 'project_01',
  name: 'Export project',
  createdAt: '2026-07-22T00:00:00.000Z',
  updatedAt: '2026-07-22T00:00:00.000Z',
  assets: [{
    id: 'asset_01',
    displayName: 'Clip',
    projectRelativePath: 'assets/asset_01/original.webm',
    kind: 'video',
    mimeType: 'video/webm',
    byteLength: 4,
    metadata: { durationMs: 1_000, width: 640, height: 360 },
    createdAt: '2026-07-22T00:00:00.000Z',
    updatedAt: '2026-07-22T00:00:00.000Z'
  }],
  ai: createEmptyAiProjectDocument(),
  timeline: {
    schemaVersion: TIMELINE_SCHEMA_VERSION,
    tracks: [{
      id: 'video-track',
      name: 'Video',
      kind: 'video',
      clips: [{
        id: 'clip_01',
        assetId: 'asset_01',
        timelineStartMs: 0,
        sourceStartMs: 0,
        sourceEndMs: 1_000,
        sourceDurationMs: 1_000,
        effects: DEFAULT_CLIP_EFFECTS,
        keyframes: []
      }]
    }],
    transitions: []
  }
};

async function openSource(sourcePath: string) {
  return {
    file: await open(sourcePath, 'r'),
    filePath: sourcePath,
    mimeType: 'video/webm',
    byteLength: 4
  };
}

describe('export IPC service', () => {
  it('reports FFmpeg readiness without exposing executable paths or arguments', async () => {
    const root = await mkdtemp(join(tmpdir(), 'export-service-'));
    const service = new ExportIpcService({
      projects: { open: async () => SNAPSHOT },
      assets: { openPlaybackSource: async () => null },
      jobs: new ExportJobStore({ createId: () => 'export_01' }),
      exportsRoot: join(root, 'exports'),
      discoverFfmpeg: async () => ({ kind: 'configured', executablePath: join(root, 'bin', 'ffmpeg') })
    });

    const readiness = await service.getFfmpegRuntimeStatus();

    expect(readiness).toEqual({ ok: true, value: { kind: 'configured' } });
    expect(JSON.stringify(readiness)).not.toContain(root);
    expect(JSON.stringify(readiness)).not.toMatch(/executablePath|argv|args/);
  });

  it('runs a background export, polls path-free state, and opens only the completed known result', async () => {
    const root = await mkdtemp(join(tmpdir(), 'export-service-'));
    const sourcePath = join(root, 'source.webm');
    await writeFile(sourcePath, 'clip');
    const backgroundTasks: Promise<void>[] = [];
    const opened: string[] = [];
    const revealed: string[] = [];
    const processInputs: StartFfmpegExportProcessInput[] = [];
    const service = new ExportIpcService({
      projects: { open: async () => SNAPSHOT },
      assets: { openPlaybackSource: async () => openSource(sourcePath) },
      jobs: new ExportJobStore({ createId: () => 'export_01' }),
      exportsRoot: join(root, 'exports'),
      discoverFfmpeg: async () => ({ kind: 'system', executablePath: process.execPath }),
      startProcess: (input): FfmpegExecution => {
        processInputs.push(input);
        const outputPath = input.args.at(-1);
        if (outputPath === undefined) {
          throw new Error('Expected output path argument.');
        }
        return { completion: writeFile(outputPath, 'mp4'), cancel: () => undefined };
      },
      runInBackground: (task) => backgroundTasks.push(task()),
      openPath: async (path) => {
        opened.push(path);
        return '';
      },
      revealPath: (path) => revealed.push(path)
    });

    const started = await service.startExportJob({ projectId: 'project_01', width: 640, height: 360, frameRate: 24 });
    expect(started).toMatchObject({ ok: true, value: { id: 'export_01', state: { kind: 'queued' } } });
    expect(JSON.stringify(started)).not.toContain(root);
    await Promise.all(backgroundTasks);

    const completed = await service.getExportJob({ jobId: 'export_01' });
    expect(completed).toMatchObject({ ok: true, value: { state: { kind: 'completed', fileName: 'export_01.mp4' } } });
    expect(JSON.stringify(completed)).not.toContain(root);
    expect(processInputs[0]?.args).not.toContain(sourcePath);
    expect(processInputs[0]?.args.some((argument) => argument.includes('.stage-export_01-'))).toBe(true);
    await expect(service.openExportResult({ jobId: 'export_01' })).resolves.toEqual({ ok: true, value: { opened: true } });
    await expect(service.revealExportResult({ jobId: 'export_01' })).resolves.toEqual({ ok: true, value: { revealed: true } });
    expect(opened.map((path) => basename(path))).toEqual(['export_01.mp4']);
    expect(revealed.map((path) => basename(path))).toEqual(['export_01.mp4']);
  });

  it('cancels a running job and removes its partial output', async () => {
    const root = await mkdtemp(join(tmpdir(), 'export-service-'));
    const sourcePath = join(root, 'source.webm');
    await writeFile(sourcePath, 'clip');
    const backgroundTasks: Promise<void>[] = [];
    let rejectProcess: ((error: Error) => void) | undefined;
    let cancelled = false;
    const service = new ExportIpcService({
      projects: { open: async () => SNAPSHOT },
      assets: { openPlaybackSource: async () => openSource(sourcePath) },
      jobs: new ExportJobStore({ createId: () => 'export_01' }),
      exportsRoot: join(root, 'exports'),
      discoverFfmpeg: async () => ({ kind: 'system', executablePath: process.execPath }),
      startProcess: (): FfmpegExecution => ({
        completion: new Promise<void>((_resolve, reject) => {
          rejectProcess = reject;
        }),
        cancel: () => {
          cancelled = true;
          rejectProcess?.(new Error('cancelled'));
        }
      }),
      runInBackground: (task) => backgroundTasks.push(task())
    });

    await service.startExportJob({ projectId: 'project_01' });
    await expect(service.cancelExportJob({ jobId: 'export_01' })).resolves.toEqual({ ok: true, value: { cancelled: true } });
    await Promise.all(backgroundTasks);

    expect(cancelled).toBe(true);
    await expect(service.getExportJob({ jobId: 'export_01' })).resolves.toMatchObject({
      ok: true,
      value: { state: { kind: 'cancelled' } }
    });
  });

  it('marks the job failed when process startup throws synchronously', async () => {
    const root = await mkdtemp(join(tmpdir(), 'export-service-'));
    const sourcePath = join(root, 'source.webm');
    await writeFile(sourcePath, 'clip');
    const backgroundTasks: Promise<void>[] = [];
    const service = new ExportIpcService({
      projects: { open: async () => SNAPSHOT },
      assets: { openPlaybackSource: async () => openSource(sourcePath) },
      jobs: new ExportJobStore({ createId: () => 'export_01' }),
      exportsRoot: join(root, 'exports'),
      discoverFfmpeg: async () => ({ kind: 'system', executablePath: process.execPath }),
      startProcess: () => {
        throw new Error('spawn setup failed');
      },
      runInBackground: (task) => backgroundTasks.push(task())
    });

    await service.startExportJob({ projectId: 'project_01' });
    await Promise.all(backgroundTasks);

    await expect(service.getExportJob({ jobId: 'export_01' })).resolves.toMatchObject({
      ok: true,
      value: { state: { kind: 'failed', reason: 'The local FFmpeg export failed.' } }
    });
  });
});
