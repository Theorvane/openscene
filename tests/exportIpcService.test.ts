import { access, mkdir, mkdtemp, open, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { ExportIpcService } from '../src/main/exportIpcService';
import { ExportJobStore } from '../src/main/exportJobStore';
import type { FfmpegExecution, StartFfmpegExportProcessInput } from '../src/main/ffmpegExportProcess';
import { DEFAULT_CLIP_EFFECTS, PROJECT_SCHEMA_VERSION, TIMELINE_SCHEMA_VERSION } from '../src/shared/timelineTypes';
import type { LocalProjectSnapshot } from '../src/shared/timelineTypes';
import { createEmptyAiProjectDocument } from '../src/shared/aiProjectDomain';
import { PERSONAL_CONTAINER_METADATA_FIELDS } from '../src/shared/metadataPrivacy';

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
  const authorField = PERSONAL_CONTAINER_METADATA_FIELDS.find((field) => field.key === 'author')!;
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
    expect(completed).toMatchObject({ ok: true, value: { state: {
      kind: 'completed', fileName: 'export_01.mp4', provenanceFileName: 'export_01.provenance.json'
    } } });
    expect(JSON.stringify(completed)).not.toContain(root);
    expect(processInputs[0]?.args).not.toContain(sourcePath);
    expect(processInputs[0]?.args.some((argument) => argument.includes('.stage-export_01-'))).toBe(true);
    await expect(service.openExportResult({ jobId: 'export_01' })).resolves.toEqual({ ok: true, value: { opened: true } });
    await expect(service.revealExportResult({ jobId: 'export_01' })).resolves.toEqual({ ok: true, value: { revealed: true } });
    expect(opened.map((path) => basename(path))).toEqual(['export_01.mp4']);
    expect(revealed.map((path) => basename(path))).toEqual(['export_01.mp4']);
    const provenance = JSON.parse(await readFile(join(root, 'exports', 'export_01.provenance.json'), 'utf8')) as {
      delivery: { output: { sha256: string }; metadataPrivacyMode: string };
    };
    expect(provenance.delivery.output.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(provenance.delivery.metadataPrivacyMode).toBe('preserve_provenance');
  });

  it('passes the selected Privacy Clean allowlist to FFmpeg without targeting provenance tags', async () => {
    const root = await mkdtemp(join(tmpdir(), 'export-service-'));
    const sourcePath = join(root, 'source.webm');
    await writeFile(sourcePath, 'clip');
    const backgroundTasks: Promise<void>[] = [];
    const processInputs: StartFfmpegExportProcessInput[] = [];
    const service = new ExportIpcService({
      projects: { open: async () => SNAPSHOT },
      assets: { openPlaybackSource: async () => openSource(sourcePath) },
      jobs: new ExportJobStore({ createId: () => 'export_private' }),
      exportsRoot: join(root, 'exports'),
      discoverFfmpeg: async () => ({ kind: 'system', executablePath: process.execPath }),
      startProcess: (input) => {
        processInputs.push(input);
        return { completion: writeFile(input.args.at(-1)!, 'mp4'), cancel: () => undefined };
      },
      runInBackground: (task) => backgroundTasks.push(task()),
      now: () => new Date('2026-09-10T03:00:00.000Z'),
      inspectContainerMetadata: async ({ filePath }) => ({
        checked: true,
        fields: filePath.endsWith('.mp4') ? [] : [authorField]
      })
    });

    await service.startExportJob({ projectId: SNAPSHOT.id, metadataPrivacyMode: 'privacy_clean' });
    await Promise.all(backgroundTasks);

    expect(processInputs[0]?.args).toContain('location=');
    expect(processInputs[0]?.args).toContain('author=');
    expect(processInputs[0]?.args).not.toContain('copyright=');
    const manifest = JSON.parse(await readFile(join(root, 'exports', 'export_private.provenance.json'), 'utf8')) as {
      delivery: {
        exportedAt: string;
        requestedContainerMetadataKeys: string[];
        metadataPrivacyVerification: { checked: boolean; beforeFields: Array<{ key: string }>; afterFields: Array<{ key: string }> };
      };
    };
    expect(manifest.delivery.exportedAt).toBe('2026-09-10T03:00:00.000Z');
    expect(manifest.delivery.requestedContainerMetadataKeys).toContain('location');
    expect(manifest.delivery.metadataPrivacyVerification).toMatchObject({
      checked: true,
      beforeFields: [{ key: 'author' }],
      afterFields: []
    });
    await expect(service.getExportJob({ jobId: 'export_private' })).resolves.toMatchObject({
      ok: true,
      value: { state: { kind: 'completed', metadataPrivacyVerification: { checked: true, ok: true } } }
    });
  });

  it('fails closed and removes every new delivery file when Privacy Clean cannot verify a clean output', async () => {
    const root = await mkdtemp(join(tmpdir(), 'export-service-'));
    const exportsRoot = join(root, 'exports');
    const sourcePath = join(root, 'source.webm');
    await writeFile(sourcePath, 'clip');
    const backgroundTasks: Promise<void>[] = [];
    const jobs = new ExportJobStore({ createId: () => 'export_private_failed' });
    const service = new ExportIpcService({
      projects: { open: async () => SNAPSHOT },
      assets: { openPlaybackSource: async () => openSource(sourcePath) },
      jobs,
      exportsRoot,
      discoverFfmpeg: async () => ({ kind: 'system', executablePath: process.execPath }),
      startProcess: (input) => ({ completion: writeFile(input.args.at(-1)!, 'mp4'), cancel: () => undefined }),
      runInBackground: (task) => backgroundTasks.push(task()),
      inspectContainerMetadata: async ({ filePath }) => ({
        checked: true,
        fields: filePath.endsWith('.mp4') ? [authorField] : []
      })
    });

    await service.startExportJob({ projectId: SNAPSHOT.id, metadataPrivacyMode: 'privacy_clean' });
    await Promise.all(backgroundTasks);

    expect(jobs.get('export_private_failed')?.state).toMatchObject({
      kind: 'failed',
      reason: expect.stringContaining('Author name')
    });
    await expect(access(join(exportsRoot, 'export_private_failed.mp4'))).rejects.toThrow();
    await expect(access(join(exportsRoot, 'export_private_failed.provenance.json'))).rejects.toThrow();
  });

  it('fails closed when Privacy Clean cannot complete the FFprobe inventory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'export-service-'));
    const exportsRoot = join(root, 'exports');
    const sourcePath = join(root, 'source.webm');
    await writeFile(sourcePath, 'clip');
    const backgroundTasks: Promise<void>[] = [];
    const jobs = new ExportJobStore({ createId: () => 'export_private_unchecked' });
    const service = new ExportIpcService({
      projects: { open: async () => SNAPSHOT },
      assets: { openPlaybackSource: async () => openSource(sourcePath) },
      jobs,
      exportsRoot,
      discoverFfmpeg: async () => ({ kind: 'system', executablePath: process.execPath }),
      startProcess: (input) => ({ completion: writeFile(input.args.at(-1)!, 'mp4'), cancel: () => undefined }),
      runInBackground: (task) => backgroundTasks.push(task()),
      inspectContainerMetadata: async () => {
        throw new Error('C:\\private\\probe failure must not cross IPC');
      }
    });

    await service.startExportJob({ projectId: SNAPSHOT.id, metadataPrivacyMode: 'privacy_clean' });
    await Promise.all(backgroundTasks);

    expect(jobs.get('export_private_unchecked')?.state).toMatchObject({
      kind: 'failed',
      reason: expect.stringContaining('could not verify container metadata with FFprobe')
    });
    expect(JSON.stringify(jobs.get('export_private_unchecked'))).not.toContain('C:\\private');
    await expect(access(join(exportsRoot, 'export_private_unchecked.mp4'))).rejects.toThrow();
  });

  it('writes a selected sidecar after the MP4 while leaving automatic captions out of burn-in', async () => {
    const root = await mkdtemp(join(tmpdir(), 'export-service-'));
    const sourcePath = join(root, 'source.webm');
    await writeFile(sourcePath, 'clip');
    const backgroundTasks: Promise<void>[] = [];
    const processInputs: StartFfmpegExportProcessInput[] = [];
    const captioned = {
      ...SNAPSHOT,
      timeline: {
        ...SNAPSHOT.timeline,
        titles: [{ id: 'auto-caption-a-1', text: 'Xin chào', timelineStartMs: 0, timelineEndMs: 900, sizePx: 64, color: '#ffffff', positionX: 0, positionY: 360 }]
      }
    };
    const service = new ExportIpcService({
      projects: { open: async () => captioned },
      assets: { openPlaybackSource: async () => openSource(sourcePath) },
      jobs: new ExportJobStore({ createId: () => 'export_captioned' }),
      exportsRoot: join(root, 'exports'),
      discoverFfmpeg: async () => ({ kind: 'system', executablePath: process.execPath }),
      startProcess: (input): FfmpegExecution => {
        processInputs.push(input);
        return { completion: writeFile(input.args.at(-1)!, 'mp4'), cancel: () => undefined };
      },
      runInBackground: (task) => backgroundTasks.push(task())
    });
    const started = await service.startExportJob({
      projectId: SNAPSHOT.id,
      subtitleDelivery: { burnAutomaticCaptions: false, sidecarFormat: 'srt' }
    });
    expect(started.ok).toBe(true);
    await Promise.all(backgroundTasks);
    const completed = await service.getExportJob({ jobId: 'export_captioned' });
    expect(completed).toMatchObject({ ok: true, value: { state: { kind: 'completed', subtitleFileName: 'export_captioned.srt' } } });
    expect(processInputs[0]?.args.join(' ')).not.toContain('drawtext');
    expect(await readFile(join(root, 'exports', 'export_captioned.srt'), 'utf8')).toContain('Xin chào');
  });

  it('refuses a requested sidecar before creating a job when no automatic captions exist', async () => {
    const root = await mkdtemp(join(tmpdir(), 'export-service-'));
    const jobs = new ExportJobStore({ createId: () => 'must-not-exist' });
    const service = new ExportIpcService({
      projects: { open: async () => SNAPSHOT }, assets: { openPlaybackSource: async () => null }, jobs,
      exportsRoot: join(root, 'exports'), discoverFfmpeg: async () => ({ kind: 'system', executablePath: process.execPath })
    });
    await expect(service.startExportJob({
      projectId: SNAPSHOT.id,
      subtitleDelivery: { burnAutomaticCaptions: true, sidecarFormat: 'vtt' }
    })).resolves.toMatchObject({ ok: false, error: { code: 'EXPORT_REFUSED', message: expect.stringContaining('Apply approved automatic captions') } });
    expect(jobs.get('must-not-exist')).toBeNull();
  });

  it('fails closed and removes the MP4 when a sidecar output already exists', async () => {
    const root = await mkdtemp(join(tmpdir(), 'export-service-'));
    const exportsRoot = join(root, 'exports');
    await mkdir(exportsRoot);
    await writeFile(join(exportsRoot, 'export_collision.srt'), 'keep me');
    const sourcePath = join(root, 'source.webm');
    await writeFile(sourcePath, 'clip');
    const backgroundTasks: Promise<void>[] = [];
    const captioned = {
      ...SNAPSHOT,
      timeline: { ...SNAPSHOT.timeline, titles: [{ id: 'auto-caption-a-1', text: 'Caption', timelineStartMs: 0, timelineEndMs: 900, sizePx: 64, color: '#ffffff', positionX: 0, positionY: 360 }] }
    };
    const service = new ExportIpcService({
      projects: { open: async () => captioned }, assets: { openPlaybackSource: async () => openSource(sourcePath) },
      jobs: new ExportJobStore({ createId: () => 'export_collision' }), exportsRoot,
      discoverFfmpeg: async () => ({ kind: 'system', executablePath: process.execPath }),
      startProcess: (input) => ({ completion: writeFile(input.args.at(-1)!, 'mp4'), cancel: () => undefined }),
      runInBackground: (task) => backgroundTasks.push(task())
    });
    await service.startExportJob({ projectId: SNAPSHOT.id, subtitleDelivery: { burnAutomaticCaptions: false, sidecarFormat: 'srt' } });
    await Promise.all(backgroundTasks);
    await expect(service.getExportJob({ jobId: 'export_collision' })).resolves.toMatchObject({ ok: true, value: { state: { kind: 'failed' } } });
    await expect(access(join(exportsRoot, 'export_collision.mp4'))).rejects.toThrow();
    expect(await readFile(join(exportsRoot, 'export_collision.srt'), 'utf8')).toBe('keep me');
  });

  it('fails closed, removes its MP4, and preserves a colliding provenance file', async () => {
    const root = await mkdtemp(join(tmpdir(), 'export-service-'));
    const exportsRoot = join(root, 'exports');
    await mkdir(exportsRoot);
    await writeFile(join(exportsRoot, 'export_provenance_collision.provenance.json'), 'keep me');
    const sourcePath = join(root, 'source.webm');
    await writeFile(sourcePath, 'clip');
    const backgroundTasks: Promise<void>[] = [];
    const service = new ExportIpcService({
      projects: { open: async () => SNAPSHOT }, assets: { openPlaybackSource: async () => openSource(sourcePath) },
      jobs: new ExportJobStore({ createId: () => 'export_provenance_collision' }), exportsRoot,
      discoverFfmpeg: async () => ({ kind: 'system', executablePath: process.execPath }),
      startProcess: (input) => ({ completion: writeFile(input.args.at(-1)!, 'mp4'), cancel: () => undefined }),
      runInBackground: (task) => backgroundTasks.push(task())
    });

    await service.startExportJob({ projectId: SNAPSHOT.id });
    await Promise.all(backgroundTasks);

    await expect(service.getExportJob({ jobId: 'export_provenance_collision' })).resolves.toMatchObject({ ok: true, value: { state: { kind: 'failed' } } });
    await expect(access(join(exportsRoot, 'export_provenance_collision.mp4'))).rejects.toThrow();
    expect(await readFile(join(exportsRoot, 'export_provenance_collision.provenance.json'), 'utf8')).toBe('keep me');
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
