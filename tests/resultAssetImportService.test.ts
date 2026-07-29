import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { AssetLibraryStore } from '../src/main/assetLibraryStore';
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
