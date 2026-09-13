import { mkdtemp, open, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { AssetLibraryStore } from '../src/main/assetLibraryStore';
import { ProjectStore } from '../src/main/projectStore';
import { createTimelineAssetRequestHandler } from '../src/main/timelineAssetResponse';
import { TimelineIpcService } from '../src/main/timelineIpcService';
import { speechPreviewUrl, videoPreviewUrl } from '../src/shared/mediaPlaybackUrls';
import { createMp4MediaFixture, type Mp4MediaFixture } from './helpers/mediaFixtures';
import { createSymlinkOrSkip } from './helpers/symlinkCapability';

let mediaFixture: Mp4MediaFixture | undefined;

afterEach(async () => {
  await mediaFixture?.cleanup();
  mediaFixture = undefined;
});

async function withPlaybackFixture<T>(run: (fixture: {
  readonly request: (range?: string) => Promise<Response>;
  readonly playbackPath: string;
  readonly directory: string;
}) => Promise<T>): Promise<T> {
  const directory = await mkdtemp(join(tmpdir(), 'video-asset-response-'));
  try {
    const root = join(directory, 'projects');
    const sourcePath = join(directory, 'take.webm');
    await writeFile(sourcePath, Buffer.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]));
    const projects = new ProjectStore(root);
    const project = await projects.create({ name: 'Playback response' });
    const assets = new AssetLibraryStore(root, projects);
    const asset = await assets.import({
      projectId: project.id,
      sourcePath,
      displayName: 'Take',
      kind: 'video',
      mimeType: 'video/webm'
    });
    const playback = await assets.getPlaybackSource(project.id, asset.id);
    if (playback === null) {
      throw new Error('Expected playback fixture to resolve.');
    }
    const handler = createTimelineAssetRequestHandler(new TimelineIpcService({ projects, assets }));
    const url = `video-tool-asset://playback/${project.id}/${asset.id}`;
    return await run({
      directory,
      playbackPath: playback.filePath,
      request: (range) => handler(new Request(url, range === undefined ? {} : { headers: { Range: range } }))
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

describe('timeline asset response', () => {
  it('streams a generated speech preview by opaque job id without exposing its file path', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'video-speech-preview-'));
    const speechPath = join(directory, 'generated.wav');
    const speechBytes = Buffer.from('RIFF-preview-audio');
    try {
      await writeFile(speechPath, speechBytes);
      const handler = createTimelineAssetRequestHandler({
        openAssetPlaybackSource: async () => null,
        openGeneratedSpeechSource: async (jobId) => jobId === 'speech-job-1'
          ? { file: await open(speechPath, 'r'), filePath: speechPath, byteLength: speechBytes.byteLength, mimeType: 'audio/wav' }
          : null
      });
      const url = speechPreviewUrl('speech-job-1');

      const response = await handler(new Request(url, { headers: { Range: 'bytes=5-11' } }));

      expect(response.status).toBe(206);
      expect(response.headers.get('content-type')).toBe('audio/wav');
      expect(Buffer.from(await response.arrayBuffer())).toEqual(speechBytes.subarray(5, 12));
      expect(url).not.toContain(speechPath);
      expect((await handler(new Request('video-tool-asset://speech-preview/../escape'))).status).toBe(404);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('streams a generated video candidate by opaque job id', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'video-candidate-preview-'));
    const videoPath = join(directory, 'generated.mp4');
    const videoBytes = Buffer.from('candidate-video-bytes');
    try {
      await writeFile(videoPath, videoBytes);
      const handler = createTimelineAssetRequestHandler({
        openAssetPlaybackSource: async () => null,
        openGeneratedVideoSource: async (jobId) => jobId === 'video-job-1'
          ? { file: await open(videoPath, 'r'), filePath: videoPath, byteLength: videoBytes.byteLength, mimeType: 'video/mp4' }
          : null
      });
      const url = videoPreviewUrl('video-job-1');
      const response = await handler(new Request(url));
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe('video/mp4');
      expect(Buffer.from(await response.arrayBuffer())).toEqual(videoBytes);
      expect(url).not.toContain(videoPath);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('serves a real MP4 imported through the native picker seam without exposing its source path', async () => {
    // Given
    const mp4Fixture = await createMp4MediaFixture();
    mediaFixture = mp4Fixture;
    const sourceBytes = await readFile(mp4Fixture.filePath);
    const root = join(mp4Fixture.directory, 'projects');
    const projects = new ProjectStore(root);
    const project = await projects.create({ name: 'Imported MP4 playback' });
    const assets = new AssetLibraryStore(root, projects);
    const service = new TimelineIpcService({
      projects,
      assets,
      selectMediaFiles: async () => ({ canceled: false, filePaths: [mp4Fixture.filePath] })
    });
    const imported = await service.importProjectAssets({ projectId: project.id });
    if (!imported.ok) {
      throw new Error(`Expected MP4 import to succeed: ${imported.error.code} ${imported.error.message}`);
    }
    const asset = imported.value.assets[0];
    if (asset === undefined) {
      throw new Error('Expected one imported MP4 asset.');
    }
    const playback = await service.getAssetPlaybackUrl({ projectId: project.id, assetId: asset.id });
    if (!playback.ok) {
      throw new Error(`Expected playback URL: ${playback.error.code} ${playback.error.message}`);
    }
    const handler = createTimelineAssetRequestHandler(service);

    // When
    const response = await handler(new Request(playback.value.url));

    // Then
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('video/mp4');
    expect(response.headers.get('content-length')).toBe(String(sourceBytes.byteLength));
    expect(Buffer.from(await response.arrayBuffer())).toEqual(sourceBytes);
    expect(JSON.stringify({ imported, playback })).not.toContain(mp4Fixture.filePath);
    expect(JSON.stringify({ imported, playback })).not.toContain(mp4Fixture.directory);
  });

  it('rejects malformed and traversal-like playback URL segments', async () => {
    // Given
    const directory = await mkdtemp(join(tmpdir(), 'video-asset-malformed-'));
    try {
      const root = join(directory, 'projects');
      const projects = new ProjectStore(root);
      const project = await projects.create({ name: 'Malformed playback' });
      const handler = createTimelineAssetRequestHandler(
        new TimelineIpcService({ projects, assets: new AssetLibraryStore(root, projects) })
      );
      const urls = [
        `video-tool-asset://playback/${project.id}`,
        `video-tool-asset://playback/${project.id}/..%2Fescape`,
        `video-tool-asset://playback/${project.id}/asset/extra`
      ];

      // When
      const responses = await Promise.all(urls.map((url) => handler(new Request(url))));

      // Then
      for (const response of responses) {
        expect(response.status).toBe(404);
        expect(await response.text()).toBe('Not found');
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('given no range, when media is served, then the complete file is streamed with range capability advertised', async () => {
    await withPlaybackFixture(async ({ request }) => {
      // Given / When
      const response = await request();

      // Then
      expect(response.status).toBe(200);
      expect(response.headers.get('accept-ranges')).toBe('bytes');
      expect(response.headers.get('content-length')).toBe('10');
      expect(Buffer.from(await response.arrayBuffer())).toEqual(Buffer.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]));
    });
  });

  it('given a valid single byte range, when media is served, then only that range is streamed with partial-content headers', async () => {
    await withPlaybackFixture(async ({ request }) => {
      // Given / When
      const response = await request('bytes=2-5');

      // Then
      expect(response.status).toBe(206);
      expect(response.headers.get('accept-ranges')).toBe('bytes');
      expect(response.headers.get('content-range')).toBe('bytes 2-5/10');
      expect(response.headers.get('content-length')).toBe('4');
      expect(response.headers.get('content-type')).toBe('video/webm');
      expect(Buffer.from(await response.arrayBuffer())).toEqual(Buffer.from([2, 3, 4, 5]));
    });
  });

  it('given suffix, unsatisfiable, and multi-range requests, when media is served, then suffix works and invalid ranges return 416', async () => {
    await withPlaybackFixture(async ({ request }) => {
      // Given / When
      const suffix = await request('bytes=-3');
      const unsatisfiable = await request('bytes=20-30');
      const multiple = await request('bytes=0-1,4-5');

      // Then
      expect(suffix.status).toBe(206);
      expect(suffix.headers.get('content-range')).toBe('bytes 7-9/10');
      expect(Buffer.from(await suffix.arrayBuffer())).toEqual(Buffer.from([7, 8, 9]));
      for (const response of [unsatisfiable, multiple]) {
        expect(response.status).toBe(416);
        expect(response.headers.get('content-range')).toBe('bytes */10');
        expect(response.headers.get('content-length')).toBe('0');
      }
    });
  });

  it('given a playback URL whose file becomes a symlink, when the protocol serves it, then serve-time validation rejects it', async ({ skip }) => {
    await withPlaybackFixture(async ({ request, playbackPath, directory }) => {
      // Given
      const outsidePath = join(directory, 'outside.webm');
      await writeFile(outsidePath, Buffer.from([9, 9, 9, 9, 9, 9, 9, 9, 9, 9]));
      await rm(playbackPath);
      if (!(await createSymlinkOrSkip(outsidePath, playbackPath, skip))) return;

      // When
      const response = await request();

      // Then
      expect(response.status).toBe(404);
    });
  });
});
