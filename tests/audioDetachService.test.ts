import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { describe, expect, it } from 'vitest';

import { AssetLibraryStore } from '../src/main/assetLibraryStore';
import { AudioDetachService } from '../src/main/audioDetachService';
import { FfmpegExportProcessError } from '../src/main/ffmpegExportProcess';
import { discoverFfmpeg } from '../src/main/ffmpegDiscovery';
import { ProjectStore } from '../src/main/projectStore';

const execFileAsync = promisify(execFile);

async function withTempDirectory<T>(run: (directory: string) => Promise<T>): Promise<T> {
  const directory = await mkdtemp(join(tmpdir(), 'audio-detach-service-'));
  try {
    return await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function createVideoFixture(directory: string) {
  const root = join(directory, 'projects');
  const projects = new ProjectStore(root);
  const assets = new AssetLibraryStore(root, projects);
  const project = await projects.create({ name: 'Detach audio' });
  const sourcePath = join(directory, 'source.mp4');
  await writeFile(sourcePath, Buffer.from([1, 2, 3]));
  const imported = await assets.import({
    projectId: project.id,
    sourcePath,
    displayName: 'Camera take.mp4',
    kind: 'video',
    mimeType: 'video/mp4'
  });
  const video = await assets.updateMetadata({ projectId: project.id, assetId: imported.id, durationMs: 7_500 });
  return { projects, assets, project, video };
}

describe('audio detach service', () => {
  it('extracts a real embedded stream through the discovered FFmpeg binary', async () => {
    await withTempDirectory(async (directory) => {
      const runtime = await discoverFfmpeg();
      if (runtime.kind === 'unavailable') throw new Error(runtime.reason);
      const sourcePath = join(directory, 'source-with-sound.mp4');
      await execFileAsync(runtime.executablePath, [
        '-hide_banner', '-loglevel', 'error',
        '-f', 'lavfi', '-i', 'color=c=black:s=32x32:r=24:d=1',
        '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1',
        '-c:v', 'mpeg4', '-c:a', 'aac', '-shortest', sourcePath
      ]);
      const root = join(directory, 'real-projects');
      const projects = new ProjectStore(root);
      const assets = new AssetLibraryStore(root, projects);
      const project = await projects.create({ name: 'Real FFmpeg detach' });
      const imported = await assets.import({
        projectId: project.id,
        sourcePath,
        displayName: 'Source with sound.mp4',
        kind: 'video',
        mimeType: 'video/mp4'
      });
      const video = await assets.updateMetadata({ projectId: project.id, assetId: imported.id, durationMs: 1_000 });

      const response = await new AudioDetachService({ projects, assets, temporaryRoot: directory }).detach({
        projectId: project.id,
        assetId: video.id
      });

      expect(response.ok).toBe(true);
      if (response.ok) {
        expect(response.value.asset.byteLength).toBeGreaterThan(1_000);
        expect(response.value.asset.metadata).toEqual({ durationMs: 1_000 });
      }
    });
  }, 20_000);

  it('extracts through the main-owned source and imports a ready WAV asset', async () => {
    await withTempDirectory(async (directory) => {
      const fixture = await createVideoFixture(directory);
      const extractionInputs: Array<{ sourcePath: string; outputPath: string }> = [];
      const service = new AudioDetachService({
        ...fixture,
        temporaryRoot: directory,
        discoverFfmpeg: async () => ({ kind: 'system', executablePath: 'ffmpeg' }),
        runExtraction: async (input) => {
          extractionInputs.push(input);
          await writeFile(input.outputPath, Buffer.from([4, 5, 6, 7]));
        }
      });

      const response = await service.detach({ projectId: fixture.project.id, assetId: fixture.video.id });

      expect(response.ok).toBe(true);
      if (!response.ok) return;
      expect(response.value.asset).toMatchObject({
        displayName: 'Camera take - detached audio.wav',
        kind: 'audio',
        mimeType: 'audio/wav',
        metadata: { durationMs: 7_500 }
      });
      expect(extractionInputs[0]?.sourcePath).not.toBe(join(directory, 'source.mp4'));
      expect(extractionInputs[0]?.outputPath).toContain('openscene-detach-audio-');
      expect((await fixture.projects.open(fixture.project.id))?.assets).toHaveLength(2);
    });
  });

  it('reports a video with no audio stream without importing a false result', async () => {
    await withTempDirectory(async (directory) => {
      const fixture = await createVideoFixture(directory);
      const service = new AudioDetachService({
        ...fixture,
        temporaryRoot: directory,
        discoverFfmpeg: async () => ({ kind: 'system', executablePath: 'ffmpeg' }),
        runExtraction: async () => {
          throw new FfmpegExportProcessError('PROCESS_FAILED', 'failed', "Stream map '0:a:0' matches no streams");
        }
      });

      await expect(service.detach({ projectId: fixture.project.id, assetId: fixture.video.id })).resolves.toEqual({
        ok: false,
        error: { code: 'AUDIO_NOT_FOUND', message: 'This video does not contain an audio stream to detach.' }
      });
      expect((await fixture.projects.open(fixture.project.id))?.assets).toHaveLength(1);
    });
  });

  it('rejects non-video assets and unavailable FFmpeg with actionable errors', async () => {
    await withTempDirectory(async (directory) => {
      const fixture = await createVideoFixture(directory);
      const service = new AudioDetachService({
        ...fixture,
        discoverFfmpeg: async () => ({ kind: 'unavailable', reason: 'FFmpeg is missing.' })
      });
      await expect(service.detach({ projectId: fixture.project.id, assetId: fixture.video.id })).resolves.toEqual({
        ok: false,
        error: {
          code: 'AUDIO_EXTRACTION_UNAVAILABLE',
          message: 'FFmpeg is missing. Configure VIDEO_TOOL_FFMPEG_PATH and restart OpenScene.'
        }
      });
      await expect(service.detach({ projectId: '../escape', assetId: fixture.video.id })).resolves.toMatchObject({
        ok: false,
        error: { code: 'INVALID_INPUT' }
      });
    });
  });
});
