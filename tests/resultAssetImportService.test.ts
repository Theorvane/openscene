import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { AssetLibraryStore } from '../src/main/assetLibraryStore';
import { ProjectLocationRegistry } from '../src/main/projectLocations';
import { ProjectStore } from '../src/main/projectStore';
import { ResultAssetImportService, type CompletedResultAssetSource } from '../src/main/resultAssetImportService';

async function withTempDirectory<T>(run: (directory: string) => Promise<T>): Promise<T> {
  const directory = await mkdtemp(join(tmpdir(), 'video-result-asset-import-'));
  try {
    return await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

describe('completed result asset import service', () => {
  it('imports a completed generated image as a project image asset', async () => {
    await withTempDirectory(async (directory) => {
      const root = join(directory, 'projects');
      const imagePath = join(directory, 'generated storyboard.png');
      const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      await writeFile(imagePath, png);
      const projects = new ProjectStore(root);
      const project = await projects.create({ name: 'Generated storyboard' });
      const service = new ResultAssetImportService({
        assets: new AssetLibraryStore(root, projects),
        resolveRecordingSource: () => null,
        resolveAiSource: () => ({
          sourcePath: imagePath,
          displayName: 'AI_Image_board.png',
          kind: 'image',
          mimeType: 'image/png'
        })
      });

      const imported = await service.importAiResult({ projectId: project.id, jobId: 'image-job-1' });

      expect(imported.ok).toBe(true);
      if (!imported.ok) return;
      expect(imported.value.assets).toMatchObject([{
        displayName: 'AI_Image_board.png',
        kind: 'image',
        mimeType: 'image/png'
      }]);
      await expect(readFile(join(root, project.id, imported.value.assets[0]?.projectRelativePath ?? ''))).resolves.toEqual(png);
    });
  });

  it('coalesces concurrent retries and reuses the persisted result asset after service restart', async () => {
    await withTempDirectory(async (directory) => {
      const root = join(directory, 'projects');
      const imagePath = join(directory, 'generated storyboard.png');
      await writeFile(imagePath, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
      const projects = new ProjectStore(root);
      const project = await projects.create({ name: 'Idempotent import' });
      const assets = new AssetLibraryStore(root, projects);
      let resolverCalls = 0;
      const service = new ResultAssetImportService({
        assets,
        resolveRecordingSource: () => null,
        resolveAiSource: () => {
          resolverCalls += 1;
          return { sourcePath: imagePath, displayName: 'storyboard.png', kind: 'image', mimeType: 'image/png' };
        }
      });
      const payload = { projectId: project.id, jobId: 'image-job-1' };

      const [first, concurrent] = await Promise.all([service.importAiResult(payload), service.importAiResult(payload)]);
      const sequential = await service.importAiResult(payload);
      const restarted = await new ResultAssetImportService({
        assets: new AssetLibraryStore(root, new ProjectStore(root)),
        resolveRecordingSource: () => null,
        resolveAiSource: () => null
      }).importAiResult(payload);

      expect(first.ok && concurrent.ok && sequential.ok && restarted.ok).toBe(true);
      if (!first.ok || !concurrent.ok || !sequential.ok || !restarted.ok) return;
      const assetId = first.value.assets[0]?.id;
      expect(assetId).toBeDefined();
      expect(concurrent.value.assets[0]?.id).toBe(assetId);
      expect(sequential.value.assets[0]?.id).toBe(assetId);
      expect(restarted.value.assets[0]?.id).toBe(assetId);
      expect(resolverCalls).toBe(1);
      expect((await new ProjectStore(root).open(project.id))?.assets).toMatchObject([{
        id: assetId,
        resultOrigin: { kind: 'ai-generation', resultId: 'image-job-1' }
      }]);
    });
  });

  it('converges on one asset when separate service instances import the same result concurrently', async () => {
    await withTempDirectory(async (directory) => {
      const root = join(directory, 'projects');
      const sourcePath = join(directory, 'speech.wav');
      await writeFile(sourcePath, Buffer.from('RIFF-voice'));
      const projects = new ProjectStore(root);
      const project = await projects.create({ name: 'Concurrent services' });
      const assets = new AssetLibraryStore(root, projects);
      const dependencies = {
        assets,
        resolveRecordingSource: () => null,
        resolveAiSource: () => ({ sourcePath, displayName: 'speech.wav', kind: 'audio' as const, mimeType: 'audio/wav' })
      };

      const [first, second] = await Promise.all([
        new ResultAssetImportService(dependencies).importAiResult({ projectId: project.id, jobId: 'job-shared' }),
        new ResultAssetImportService(dependencies).importAiResult({ projectId: project.id, jobId: 'job-shared' })
      ]);

      expect(first.ok && second.ok).toBe(true);
      if (!first.ok || !second.ok) return;
      expect(second.value.assets[0]?.id).toBe(first.value.assets[0]?.id);
      expect((await projects.open(project.id))?.assets).toHaveLength(1);
      expect(await readdir(join(root, project.id, 'assets'))).toHaveLength(1);
    });
  });

  it('imports generated speech into a registered external project folder whose path contains spaces', async () => {
    await withTempDirectory(async (directory) => {
      const projectsRoot = join(directory, 'internal projects');
      const externalFolder = join(directory, 'creator project with spaces');
      const speechPath = join(directory, 'speech result.wav');
      await mkdir(externalFolder);
      await writeFile(speechPath, Buffer.from('RIFF-voice'));
      const locations = new ProjectLocationRegistry(join(directory, 'project-locations.json'));
      const projects = new ProjectStore(projectsRoot, locations);
      const opened = await projects.openOrInitializeFolder(externalFolder);
      if (opened === null) throw new Error('Expected the external project fixture to open.');
      const service = new ResultAssetImportService({
        assets: new AssetLibraryStore(projectsRoot, projects),
        resolveRecordingSource: () => null,
        resolveAiSource: () => ({ sourcePath: speechPath, displayName: 'speech result.wav', kind: 'audio', mimeType: 'audio/wav' })
      });

      const imported = await service.importAiResult({ projectId: opened.project.id, jobId: 'speech-job-1' });

      expect(imported.ok).toBe(true);
      if (!imported.ok) return;
      const asset = imported.value.assets[0];
      expect(asset).toBeDefined();
      await expect(readFile(join(externalFolder, asset?.projectRelativePath ?? ''))).resolves.toEqual(Buffer.from('RIFF-voice'));
    });
  });

  it('given completed recording and TTS IDs, when imported, then copied path-free assets are returned', async () => {
    await withTempDirectory(async (directory) => {
      const root = join(directory, 'projects');
      const recordingPath = join(directory, 'recording.webm');
      const ttsPath = join(directory, 'speech.wav');
      await writeFile(recordingPath, Buffer.from([1, 2]));
      await writeFile(ttsPath, Buffer.from([3]));
      const projects = new ProjectStore(root);
      const project = await projects.create({ name: 'Results' });
      const service = new ResultAssetImportService({
        assets: new AssetLibraryStore(root, projects),
        resolveRecordingSource: (sessionId) => sessionId === 'session_01'
          ? { sourcePath: recordingPath, displayName: 'recording.webm', kind: 'video', mimeType: 'video/webm' }
          : null,
        resolveAiSource: (jobId: string) => jobId === 'job_01'
          ? { sourcePath: ttsPath, displayName: 'speech.wav', kind: 'audio', mimeType: 'audio/wav' }
          : null
      });

      const importedRecording = await service.importRecordingResult({ projectId: project.id, sessionId: 'session_01' });
      const importedTts = await service.importAiResult({ projectId: project.id, jobId: 'job_01' });

      if (!importedRecording.ok || !importedTts.ok) {
        throw new Error('Expected both result imports to succeed.');
      }
      expect(importedRecording.value.assets).toMatchObject([{ displayName: 'recording.webm', kind: 'video', mimeType: 'video/webm' }]);
      expect(importedTts.value.assets).toMatchObject([{ displayName: 'speech.wav', kind: 'audio', mimeType: 'audio/wav' }]);
      expect(JSON.stringify({ importedRecording, importedTts })).not.toContain(directory);
      await expect(readFile(join(root, project.id, importedRecording.value.assets[0]?.projectRelativePath ?? ''))).resolves.toEqual(Buffer.from([1, 2]));
      await expect(readFile(join(root, project.id, importedTts.value.assets[0]?.projectRelativePath ?? ''))).resolves.toEqual(Buffer.from([3]));
    });
  });

  it('given invalid payload fields, when import is requested, then paths are rejected before resolver access', async () => {
    await withTempDirectory(async (directory) => {
      const root = join(directory, 'projects');
      const projects = new ProjectStore(root);
      const project = await projects.create({ name: 'Strict payloads' });
      let resolverCalls = 0;
      const resolver = (): CompletedResultAssetSource | null => {
        resolverCalls += 1;
        return null;
      };
      const service = new ResultAssetImportService({
        assets: new AssetLibraryStore(root, projects),
        resolveRecordingSource: resolver,
        resolveAiSource: resolver
      });

      await expect(service.importRecordingResult({ projectId: project.id, sessionId: 'session_01', outputPath: '/tmp/take.webm' })).resolves.toEqual({
        ok: false,
        error: { code: 'INVALID_INPUT', message: 'The recording result import payload was not valid.' }
      });
      await expect(service.importAiResult({ projectId: project.id, jobId: 'job_01', sourcePath: '/tmp/speech.wav' })).resolves.toEqual({
        ok: false,
        error: { code: 'INVALID_INPUT', message: 'The AI result import payload was not valid.' }
      });
      expect(resolverCalls).toBe(0);
    });
  });

  it('given unknown or unavailable results, when import is requested, then the project is unchanged', async () => {
    await withTempDirectory(async (directory) => {
      const root = join(directory, 'projects');
      const projects = new ProjectStore(root);
      const project = await projects.create({ name: 'No mutation' });
      const service = new ResultAssetImportService({
        assets: new AssetLibraryStore(root, projects),
        resolveRecordingSource: () => null,
        resolveAiSource: () => ({ sourcePath: join(directory, 'missing.wav'), displayName: 'missing.wav', kind: 'audio', mimeType: 'audio/wav' })
      });

      const missingRecording = await service.importRecordingResult({ projectId: project.id, sessionId: 'missing_session' });
      const missingTtsFile = await service.importAiResult({ projectId: project.id, jobId: 'job_01' });

      expect(missingRecording).toEqual({ ok: false, error: { code: 'SESSION_NOT_FOUND', message: 'The completed recording result is not available.' } });
      expect(missingTtsFile).toEqual({ ok: false, error: { code: 'FILE_WRITE_FAILED', message: 'The completed AI generation result could not be imported.' } });
      expect((await projects.open(project.id))?.assets).toEqual([]);
    });
  });
});
