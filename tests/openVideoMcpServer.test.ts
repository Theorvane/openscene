import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fail, ok } from '../src/main/ipcResponses';
import { getOpenVideoMcpDefinition, OpenVideoMcpServer } from '../src/main/openVideoMcpServer';
import { ProjectStore } from '../src/main/projectStore';
import type { MediaAsset } from '../src/shared/timelineTypes';

const videoAsset = (): MediaAsset => ({
  id: 'asset-placement-000000001',
  displayName: 'clip.mp4',
  projectRelativePath: 'assets/asset-placement-000000001/original.mp4',
  kind: 'video',
  mimeType: 'video/mp4',
  byteLength: 2048,
  createdAt: '2026-07-24T12:00:00.000Z',
  updatedAt: '2026-07-24T12:00:00.000Z',
  metadata: { durationMs: 10_000, width: 1920, height: 1080 }
});

describe('OpenScene TypeMCP Server and Tool declarations', () => {
  let tempDir: string;
  let projectStore: ProjectStore;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'openvideo-mcp-test-'));
    projectStore = new ProjectStore(tempDir);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('extracts server metadata and declared MCP tools using getMcpServerDefinition', () => {
    const definition = getOpenVideoMcpDefinition();
    expect(definition).toBeDefined();
    expect(definition?.name).toBe('openvideo-mcp-server');
    expect(definition?.version).toBe('0.1.0');

    const toolNames = definition?.tools.map((t) => t.name);
    expect(toolNames).toContain('watchProjectVideo');
    expect(toolNames).toContain('createVideoJob');
    expect(toolNames).toContain('createSpeechJob');
    expect(toolNames).toContain('getJobStatus');
    expect(toolNames).toContain('getProjectTimeline');
    expect(toolNames).toContain('trimTimelineClip');
    expect(toolNames).toContain('updateClipEffects');
    expect(toolNames).toContain('addClipToTimeline');
    expect(toolNames).toContain('importGeneratedResult');
    expect(toolNames).toContain('removeTimelineClip');
    expect(toolNames).toContain('exportProjectVideo');
  });

  it('imports a completed generation job as a project asset and tells open editors to reload', async () => {
    const server = new OpenVideoMcpServer();
    const changed: string[] = [];
    server.setProjectTimelineChangeNotifier((projectId) => changed.push(projectId));

    // Without the service the tool refuses instead of pretending to import.
    expect(await server.importGeneratedResult({ projectId: 'p1', jobId: 'job-1' })).toMatchObject({
      success: false,
      error: 'Result import service is not available.'
    });

    server.setResultImportService({
      importAiResult: async () => ok({
        assets: [{
          id: 'asset-generated',
          displayName: 'narration.wav',
          kind: 'audio',
          mimeType: 'audio/wav',
          projectRelativePath: 'assets/asset-generated/original.wav',
          byteLength: 2048,
          metadata: { durationMs: 4_000 },
          createdAt: '2026-07-29T00:00:00.000Z',
          updatedAt: '2026-07-29T00:00:00.000Z'
        }]
      })
    } as unknown as Parameters<OpenVideoMcpServer['setResultImportService']>[0]);

    const imported = await server.importGeneratedResult({ projectId: 'p1', jobId: 'job-1' });

    expect(imported).toMatchObject({ success: true, projectId: 'p1', jobId: 'job-1' });
    expect(imported.assets).toEqual([{ id: 'asset-generated', displayName: 'narration.wav', kind: 'audio', durationMs: 4_000 }]);
    expect(changed).toEqual(['p1']);
  });

  it('reports an import failure instead of claiming the asset landed', async () => {
    const server = new OpenVideoMcpServer();
    server.setResultImportService({
      importAiResult: async () => fail('TTS_RESULT_UNAVAILABLE', 'The completed AI generation result is not available.')
    } as unknown as Parameters<OpenVideoMcpServer['setResultImportService']>[0]);

    expect(await server.importGeneratedResult({ projectId: 'p1', jobId: 'missing' })).toEqual({
      success: false,
      error: 'The completed AI generation result is not available.'
    });
  });

  it('executes createVideoJob MCP tool against the selected cloud model', async () => {
    const server = new OpenVideoMcpServer();
    const result = await server.createVideoJob({
      prompt: 'Cinematic intro shot of Seoul skyline',
      aspectRatio: '16:9',
      modelId: 'sora-2'
    });

    expect(result.success).toBe(true);
    const okResult = result as { success: true; jobId: string; mode: string; provider: string };
    expect(okResult.jobId.length).toBeGreaterThan(0);
    // Media generation is cloud-only; Ollama is the app's only local engine.
    expect(okResult.mode).toBe('api');
    expect(okResult.provider).toBe('openai_sora');
  });

  it('rejects a video model whose adapter is not implemented', async () => {
    const server = new OpenVideoMcpServer();

    await expect(server.createVideoJob({
      prompt: 'Cinematic intro shot of Seoul skyline',
      modelId: 'kling-v2.5-turbo'
    })).rejects.toThrow('is not available for video-generation');
  });

  it('executes createSpeechJob MCP tool against the selected cloud model', async () => {
    const server = new OpenVideoMcpServer();
    const result = await server.createSpeechJob({
      script: 'Welcome to OpenScene desktop suite',
      voiceId: '',
      modelId: 'eleven_multilingual_v2'
    });

    expect(result.success).toBe(true);
    const okResult = result as { success: true; jobId: string; mode: string; provider: string };
    expect(okResult.jobId.length).toBeGreaterThan(0);
    expect(okResult.mode).toBe('api');
    expect(okResult.provider).toBe('elevenlabs');
  });

  it('returns a path-free read-only timeline summary only for an existing project', async () => {
    const server = new OpenVideoMcpServer();

    const withoutService = await server.getProjectTimeline({ projectId: 'project-missing' });
    expect(withoutService).toMatchObject({ success: false, error: 'ProjectStore service is not available.' });

    server.setServices(projectStore);
    const project = await projectStore.create({ name: 'Planning-safe timeline' });
    const nowIso = new Date('2026-07-26T12:00:00.000Z').toISOString();
    const asset: MediaAsset = {
      id: 'asset-safe-timeline',
      displayName: 'safe-source.mp4',
      projectRelativePath: 'assets/asset-safe-timeline/original.mp4',
      kind: 'video',
      mimeType: 'video/mp4',
      byteLength: 1024,
      createdAt: nowIso,
      updatedAt: nowIso,
      metadata: { durationMs: 8_000, width: 1920, height: 1080 }
    };
    await projectStore.registerAsset(project.id, asset);

    const result = await server.getProjectTimeline({ projectId: project.id });
    expect(result).toMatchObject({
      success: true,
      project: {
        id: project.id,
        name: 'Planning-safe timeline',
        assets: [{ id: asset.id, displayName: asset.displayName, kind: 'video', durationMs: 8_000 }]
      }
    });
    expect(JSON.stringify(result)).not.toContain('projectRelativePath');
    expect(JSON.stringify(result)).not.toContain('original.mp4');
  });

  it('trims exactly one existing clip only when its source range is valid', async () => {
    const server = new OpenVideoMcpServer();
    server.setServices(projectStore);
    const project = await projectStore.create({ name: 'Trim-safe project' });
    const nowIso = new Date('2026-07-26T14:00:00.000Z').toISOString();
    const asset: MediaAsset = {
      id: 'asset-trim-source',
      displayName: 'trim-source.mp4',
      projectRelativePath: 'assets/asset-trim-source/original.mp4',
      kind: 'video',
      mimeType: 'video/mp4',
      byteLength: 1024,
      createdAt: nowIso,
      updatedAt: nowIso,
      metadata: { durationMs: 10_000, width: 1920, height: 1080 }
    };
    await projectStore.registerAsset(project.id, asset);
    const trackId = project.timeline.tracks[0]!.id;
    const added = await server.addClipToTimeline({
      projectId: project.id,
      trackId,
      assetId: asset.id,
      startOffsetSeconds: 0,
      durationSeconds: 8
    });
    expect(added.success).toBe(true);
    const clipId = (added as { clipId: string }).clipId;

    const rejected = await server.trimTimelineClip({
      projectId: project.id,
      clipId,
      sourceStartMs: 6_000,
      sourceEndMs: 6_000
    });
    expect(rejected).toMatchObject({ success: false, error: expect.stringContaining('greater than sourceStartMs') });

    const trimmed = await server.trimTimelineClip({
      projectId: project.id,
      clipId,
      sourceStartMs: 1_000,
      sourceEndMs: 5_000
    });
    expect(trimmed).toMatchObject({ success: true, clipId, sourceStartMs: 1_000, sourceEndMs: 5_000 });

    const reloaded = await projectStore.open(project.id);
    const clip = reloaded?.timeline.tracks.find((track) => track.id === trackId)?.clips[0];
    expect(clip).toMatchObject({ id: clipId, sourceStartMs: 1_000, sourceEndMs: 5_000 });
  });

  it('updates only requested bounded effects on an existing clip', async () => {
    const server = new OpenVideoMcpServer();
    server.setServices(projectStore);
    const project = await projectStore.create({ name: 'Effect-safe project' });
    const nowIso = new Date('2026-07-27T01:00:00.000Z').toISOString();
    const asset: MediaAsset = {
      id: 'asset-effects-source', displayName: 'effects.mp4', projectRelativePath: 'assets/asset-effects-source/original.mp4',
      kind: 'video', mimeType: 'video/mp4', byteLength: 1024, createdAt: nowIso, updatedAt: nowIso,
      metadata: { durationMs: 10_000, width: 1920, height: 1080 }
    };
    await projectStore.registerAsset(project.id, asset);
    const trackId = project.timeline.tracks[0]!.id;
    const added = await server.addClipToTimeline({ projectId: project.id, trackId, assetId: asset.id, startOffsetSeconds: 0, durationSeconds: 5 });
    const clipId = (added as { clipId: string }).clipId;

    const rejected = await server.updateClipEffects({ projectId: project.id, clipId, effects: { opacity: 2 } });
    expect(rejected).toMatchObject({ success: false, error: expect.stringContaining('opacity') });

    const updated = await server.updateClipEffects({ projectId: project.id, clipId, effects: { opacity: 0.5, scale: 1.25 } });
    expect(updated).toMatchObject({ success: true, clipId, effects: { opacity: 0.5, scale: 1.25 } });
    const clip = (await projectStore.open(project.id))?.timeline.tracks.find((track) => track.id === trackId)?.clips[0];
    expect(clip?.effects).toMatchObject({ opacity: 0.5, scale: 1.25, volume: 1 });
  });

  it('fails addClipToTimeline when ProjectStore service is missing or project/track/asset is not found', async () => {
    const server = new OpenVideoMcpServer();

    // 1. Missing ProjectStore service
    const noServiceResult = await server.addClipToTimeline({
      projectId: 'proj-123',
      trackId: 'track-v1',
      assetId: 'asset-123',
      startOffsetSeconds: 0,
      durationSeconds: 5
    });
    expect(noServiceResult.success).toBe(false);
    expect(noServiceResult.error).toContain('ProjectStore service is not available');

    // Attach ProjectStore
    server.setServices(projectStore);

    // 2. Missing project
    const noProjectResult = await server.addClipToTimeline({
      projectId: 'proj-nonexistent',
      trackId: 'track-v1',
      assetId: 'asset-123',
      startOffsetSeconds: 0,
      durationSeconds: 5
    });
    expect(noProjectResult.success).toBe(false);
    expect(noProjectResult.error).toContain('Project proj-nonexistent not found');

    // Create a real project
    const project = await projectStore.create({ name: 'Test MCP Project' });

    // 3. Missing asset — resolved before the track, because the track is chosen
    //    from the asset kind when the caller does not name one.
    const noAssetResult = await server.addClipToTimeline({
      projectId: project.id,
      assetId: 'asset-invalid',
      startOffsetSeconds: 0,
      durationSeconds: 5
    });
    expect(noAssetResult.success).toBe(false);
    expect(noAssetResult.error).toContain('Asset asset-invalid not found');

    // 4. Missing track, named explicitly. The error names the tracks that exist
    //    so the agent can retry instead of guessing again.
    await projectStore.registerAsset(project.id, videoAsset());
    const noTrackResult = await server.addClipToTimeline({
      projectId: project.id,
      trackId: 'track-invalid',
      assetId: videoAsset().id,
      startOffsetSeconds: 0,
      durationSeconds: 5
    });
    expect(noTrackResult.success).toBe(false);
    expect(noTrackResult.error).toContain('Track track-invalid not found');
    expect(noTrackResult.error).toContain('video-track-1 (video)');
  });

  it('places an added clip without a track id or offset: first matching track, appended after the last clip', async () => {
    const server = new OpenVideoMcpServer();
    const changed: string[] = [];
    server.setServices(projectStore);
    server.setProjectTimelineChangeNotifier((projectId) => changed.push(projectId));

    const project = await projectStore.create({ name: 'Placement Project' });
    await projectStore.registerAsset(project.id, videoAsset());

    // No trackId and no offset: the video asset lands at 0 on the video track.
    const first = await server.addClipToTimeline({ projectId: project.id, assetId: videoAsset().id });
    expect(first).toMatchObject({ success: true, trackId: 'video-track-1', startOffsetSeconds: 0 });
    // The whole asset, not an arbitrary default length.
    expect(first.durationSeconds).toBe(10);

    // The next one appends after it rather than overlapping at 0.
    const second = await server.addClipToTimeline({ projectId: project.id, assetId: videoAsset().id });
    expect(second).toMatchObject({ success: true, startOffsetSeconds: 10 });

    // An explicit overlapping offset is refused, matching the editor's rules.
    const overlapping = await server.addClipToTimeline({
      projectId: project.id,
      assetId: videoAsset().id,
      startOffsetSeconds: 5
    });
    expect(overlapping.success).toBe(false);
    expect(overlapping.error).toContain('overlap');

    // Every successful write tells open editors to reload.
    expect(changed).toEqual([project.id, project.id]);
  });

  it('successfully adds clip to timeline and persists project when project, track, and asset exist', async () => {
    const server = new OpenVideoMcpServer();
    server.setServices(projectStore);

    const project = await projectStore.create({ name: 'Real Project' });
    const nowIso = new Date('2026-07-24T12:00:00.000Z').toISOString();
    const dummyAsset: MediaAsset = {
      id: 'asset-sample-123456789',
      displayName: 'sample.mp4',
      projectRelativePath: 'assets/asset-sample-123456789/original.mp4',
      kind: 'video',
      mimeType: 'video/mp4',
      byteLength: 1024,
      createdAt: nowIso,
      updatedAt: nowIso,
      metadata: { durationMs: 10000, width: 1920, height: 1080 }
    };

    await projectStore.registerAsset(project.id, dummyAsset);
    const validTrackId = project.timeline.tracks[0]!.id;

    const clipResult = await server.addClipToTimeline({
      projectId: project.id,
      trackId: validTrackId,
      assetId: dummyAsset.id,
      startOffsetSeconds: 2,
      durationSeconds: 4
    });

    expect(clipResult.success).toBe(true);
    expect(clipResult.clipId).toMatch(/^clip-/);

    // Verify timeline was actually mutated and saved in projectStore
    const reloaded = await projectStore.open(project.id);
    const targetTrack = reloaded?.timeline.tracks.find((t) => t.id === validTrackId);
    expect(targetTrack?.clips).toHaveLength(1);
    const clip = targetTrack?.clips[0];
    expect(clip?.assetId).toBe(dummyAsset.id);
    expect(clip?.timelineStartMs).toBe(2000);
    expect((clip?.sourceEndMs ?? 0) - (clip?.sourceStartMs ?? 0)).toBe(4000);
  });

  it('removes a clip, drops its transitions, and tells open editors to reload', async () => {
    const server = new OpenVideoMcpServer();
    const changed: string[] = [];
    server.setServices(projectStore);
    server.setProjectTimelineChangeNotifier((projectId) => changed.push(projectId));

    const project = await projectStore.create({ name: 'Remove Clip Project' });
    await projectStore.registerAsset(project.id, videoAsset());
    const added = await server.addClipToTimeline({ projectId: project.id, assetId: videoAsset().id });
    expect(added.success).toBe(true);

    const removed = await server.removeTimelineClip({ projectId: project.id, clipId: added.clipId! });

    expect(removed).toMatchObject({ success: true, projectId: project.id, clipId: added.clipId });
    const reloaded = await projectStore.open(project.id);
    expect(reloaded?.timeline.tracks.flatMap((track) => track.clips)).toHaveLength(0);
    expect(changed).toEqual([project.id, project.id]);
  });

  it('refuses to report success when the clip is not on the timeline', async () => {
    const server = new OpenVideoMcpServer();
    server.setServices(projectStore);
    const project = await projectStore.create({ name: 'Remove Clip Project' });

    // deleteClip is a no-op for an unknown id, so a naive call would look like
    // it worked; the tool has to notice nothing changed.
    const result = await server.removeTimelineClip({ projectId: project.id, clipId: 'clip-missing' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('is not on the timeline');
  });

  it('validates exportProjectVideo error propagation when export service fails or succeeds', async () => {
    const server = new OpenVideoMcpServer();

    // 1. Missing ExportIpcService
    const noExportServiceResult = await server.exportProjectVideo({
      projectId: 'proj-123'
    });
    expect(noExportServiceResult.success).toBe(false);
    expect(noExportServiceResult.error).toContain('Export service is not available');

    // 2. Mock failing ExportIpcService
    const mockFailingExportService = {
      startExportJob: async () => fail('UNKNOWN_ERROR', 'FFmpeg binary not found')
    } as any;

    server.setServices(projectStore, mockFailingExportService);
    const failResult = await server.exportProjectVideo({
      projectId: 'proj-123'
    });
    expect(failResult.success).toBe(false);
    expect(failResult.error).toBe('FFmpeg binary not found');

    // 3. Mock succeeding ExportIpcService
    const mockSuccessExportService = {
      startExportJob: async () =>
        ok({
          id: 'export-job-999',
          projectId: 'proj-123',
          status: 'queued',
          progressRatio: 0,
          outputFilePath: '/tmp/output.mp4',
          error: null
        })
    } as any;

    server.setServices(projectStore, mockSuccessExportService);
    const successResult = await server.exportProjectVideo({
      projectId: 'proj-123'
    });
    expect(successResult.success).toBe(true);
    expect(successResult.exportJobId).toBe('export-job-999');
  });

  it('handles job creation, status polling, and timeline clip placement end-to-end workflow', async () => {
    const server = new OpenVideoMcpServer();
    server.setServices(projectStore);

    // 1. Create Video Job
    const jobResult = await server.createVideoJob({
      prompt: 'Cinematic intro shot',
      aspectRatio: '16:9',
      durationSeconds: 4,
      modelId: 'sora-2'
    });
    expect(jobResult.success).toBe(true);
    const okJobResult = jobResult as { success: true; jobId: string };
    expect(okJobResult.jobId.length).toBeGreaterThan(0);

    // 2. Poll Status
    const statusResult = await server.getJobStatus({
      jobId: okJobResult.jobId,
      kind: 'video'
    });
    expect(statusResult.success).toBe(true);
    expect(statusResult.status).toBeDefined();

    // 3. Register asset & add to real project timeline
    const project = await projectStore.create({ name: 'Copilot Workflow Project' });
    const nowIso = new Date('2026-07-24T12:00:00.000Z').toISOString();
    const assetId = `asset-${okJobResult.jobId}`;
    const dummyAsset: MediaAsset = {
      id: assetId,
      displayName: 'generated-video.mp4',
      projectRelativePath: `assets/${assetId}/original.mp4`,
      kind: 'video',
      mimeType: 'video/mp4',
      byteLength: 2048,
      createdAt: nowIso,
      updatedAt: nowIso,
      metadata: { durationMs: 5000, width: 1920, height: 1080 }
    };

    await projectStore.registerAsset(project.id, dummyAsset);
    const trackId = project.timeline.tracks[0]!.id;

    const clipResult = await server.addClipToTimeline({
      projectId: project.id,
      trackId,
      assetId: dummyAsset.id,
      startOffsetSeconds: 0,
      durationSeconds: 5
    });

    expect(clipResult.success).toBe(true);

    const reloaded = await projectStore.open(project.id);
    const targetTrack = reloaded?.timeline.tracks.find((t) => t.id === trackId);
    expect(targetTrack?.clips).toHaveLength(1);
    expect(targetTrack?.clips[0]!.assetId).toBe(assetId);
  });

  it('watchProjectVideo samples a confined video asset and returns path-free frames with timestamps', async () => {
    const server = new OpenVideoMcpServer();
    const seenPaths: string[] = [];
    server.setServices(projectStore, undefined, async ({ filePath, timestampsMs }) => {
      seenPaths.push(filePath);
      return timestampsMs.map((timeMs) => ({ timeMs, jpegBase64: 'ZmFrZS1qcGVn' }));
    });

    const project = await projectStore.create({ name: 'Watch Project' });
    const nowIso = new Date('2026-07-29T12:00:00.000Z').toISOString();
    const asset: MediaAsset = {
      id: 'asset-watch-123456789',
      displayName: 'take.mp4',
      projectRelativePath: 'assets/asset-watch-123456789/original.mp4',
      kind: 'video',
      mimeType: 'video/mp4',
      byteLength: 2048,
      createdAt: nowIso,
      updatedAt: nowIso,
      metadata: { durationMs: 10_000, width: 1920, height: 1080 }
    };
    await projectStore.registerAsset(project.id, asset);

    const result = await server.watchProjectVideo({ projectId: project.id, assetId: asset.id });

    expect(result.success).toBe(true);
    const watched = result as { success: true; frameCount: number; summary: string; frames: readonly { timeMs: number; timestamp: string; jpegBase64: string }[] };
    expect(watched.frameCount).toBe(8);
    expect(watched.frames[0]).toMatchObject({ timestamp: '0:00', jpegBase64: 'ZmFrZS1qcGVn' });
    expect(watched.summary).toContain('take.mp4');
    expect(JSON.stringify(result)).not.toContain(tempDir);
    expect(seenPaths[0]).toContain('original.mp4');
  });

  it('watchProjectVideo rejects non-video assets, missing assets, and missing duration without touching FFmpeg', async () => {
    const server = new OpenVideoMcpServer();
    let extractorCalls = 0;
    server.setServices(projectStore, undefined, async ({ timestampsMs }) => {
      extractorCalls += 1;
      return timestampsMs.map((timeMs) => ({ timeMs, jpegBase64: 'ZmFrZQ==' }));
    });

    const project = await projectStore.create({ name: 'Guard Project' });
    const nowIso = new Date('2026-07-29T12:00:00.000Z').toISOString();
    const audioAsset: MediaAsset = {
      id: 'asset-audio-123456789',
      displayName: 'song.mp3',
      projectRelativePath: 'assets/asset-audio-123456789/original.mp3',
      kind: 'audio',
      mimeType: 'audio/mpeg',
      byteLength: 1024,
      createdAt: nowIso,
      updatedAt: nowIso,
      metadata: { durationMs: 5_000 }
    };
    const unprobedVideo: MediaAsset = {
      id: 'asset-unprobed-12345678',
      displayName: 'raw.mp4',
      projectRelativePath: 'assets/asset-unprobed-12345678/original.mp4',
      kind: 'video',
      mimeType: 'video/mp4',
      byteLength: 1024,
      createdAt: nowIso,
      updatedAt: nowIso,
      metadata: null
    };
    await projectStore.registerAsset(project.id, audioAsset);
    await projectStore.registerAsset(project.id, unprobedVideo);

    const audioResult = await server.watchProjectVideo({ projectId: project.id, assetId: audioAsset.id });
    const unprobedResult = await server.watchProjectVideo({ projectId: project.id, assetId: unprobedVideo.id });
    const missingResult = await server.watchProjectVideo({ projectId: project.id, assetId: 'asset-none' });

    expect(audioResult).toMatchObject({ success: false, error: expect.stringContaining('not video') });
    expect(unprobedResult).toMatchObject({ success: false, error: expect.stringContaining('duration metadata') });
    expect(missingResult.success).toBe(false);
    expect(extractorCalls).toBe(0);
  });

  it('splits, titles and joins clips through the shared rules, and reports them back', async () => {
    const server = new OpenVideoMcpServer();
    server.setServices(projectStore);
    const project = await projectStore.create({ name: 'Agent-editable project' });
    const asset = videoAsset();
    await projectStore.registerAsset(project.id, asset);
    const trackId = project.timeline.tracks[0]!.id;
    const added = await server.addClipToTimeline({
      projectId: project.id, trackId, assetId: asset.id, startOffsetSeconds: 0, durationSeconds: 8
    });
    const clipId = (added as { clipId: string }).clipId;

    // A split has to land strictly inside the clip.
    const outside = await server.splitTimelineClip({ projectId: project.id, clipId, atSeconds: 8 });
    expect(outside).toMatchObject({ success: false, error: expect.stringContaining('strictly inside') });

    const split = await server.splitTimelineClip({ projectId: project.id, clipId, atSeconds: 4 });
    expect(split).toMatchObject({ success: true, leftClipId: clipId });
    const rightClipId = (split as { rightClipId: string }).rightClipId;

    // A transition needs a cut; away from one it is refused rather than guessed at.
    const nowhere = await server.setTimelineTransition({ projectId: project.id, atSeconds: 1, type: 'fade' });
    expect(nowhere).toMatchObject({ success: false, error: expect.stringContaining('No cut') });

    const joined = await server.setTimelineTransition({
      projectId: project.id, atSeconds: 4.1, type: 'dipToBlack', lengthSeconds: 0.5
    });
    expect(joined).toMatchObject({ success: true, cutSeconds: 4, type: 'dipToBlack' });

    const titled = await server.addTimelineTitle({
      projectId: project.id, text: 'Chapter one', atSeconds: 1, lengthSeconds: 2, color: '#ff8800'
    });
    expect(titled).toMatchObject({ success: true });
    const titleId = (titled as { titleId: string }).titleId;

    // Everything the agent just wrote is visible when it reads back.
    const read = await server.getProjectTimeline({ projectId: project.id });
    expect(read).toMatchObject({
      success: true,
      project: {
        timeline: {
          titles: [{ id: titleId, text: 'Chapter one', color: '#ff8800' }],
          transitions: [{ type: 'dipToBlack', durationMs: 500 }]
        }
      }
    });
    const clips = (read as { project: { timeline: { tracks: { clips: { id: string; timelineEndMs: number }[] }[] } } })
      .project.timeline.tracks[0]!.clips;
    expect(clips.map((clip) => clip.id)).toEqual([clipId, rightClipId]);
    expect(clips[0]!.timelineEndMs).toBe(4_000);

    const removedTitle = await server.removeTimelineTitle({ projectId: project.id, titleId });
    expect(removedTitle).toMatchObject({ success: true });
    const removedTransition = await server.setTimelineTransition({ projectId: project.id, atSeconds: 4 });
    expect(removedTransition).toMatchObject({ success: true, removed: true });

    const reopened = await projectStore.open(project.id);
    expect(reopened?.timeline.titles ?? []).toEqual([]);
    expect(reopened?.timeline.transitions ?? []).toEqual([]);
  });

  it('refuses a speed change that would not fit, and says which of the two reasons it is', async () => {
    const server = new OpenVideoMcpServer();
    server.setServices(projectStore);
    const project = await projectStore.create({ name: 'Retime-safe project' });
    const asset = videoAsset();
    await projectStore.registerAsset(project.id, asset);
    const trackId = project.timeline.tracks[0]!.id;
    const first = await server.addClipToTimeline({
      projectId: project.id, trackId, assetId: asset.id, startOffsetSeconds: 0, durationSeconds: 4
    });
    await server.addClipToTimeline({
      projectId: project.id, trackId, assetId: asset.id, startOffsetSeconds: 4, durationSeconds: 4
    });
    const clipId = (first as { clipId: string }).clipId;

    // Out of range and out of room are different problems and read differently.
    const tooSlow = await server.updateClipEffects({ projectId: project.id, clipId, effects: { speed: 0.01 } });
    expect(tooSlow.success).toBe(false);
    const noRoom = await server.updateClipEffects({ projectId: project.id, clipId, effects: { speed: 0.5 } });
    expect(noRoom).toMatchObject({ success: false, error: expect.stringContaining('neighbour') });

    // A refused write leaves a project that still opens.
    const reopened = await projectStore.open(project.id);
    expect(reopened?.timeline.tracks[0]!.clips).toHaveLength(2);
  });

  it('composes a shot prompt, and refines one without losing what it already said', () => {
    const server = new OpenVideoMcpServer();

    const first = server.composeShotPrompt({
      scenario: 'A courier cycles through a wet city at night',
      description: 'Close on the front wheel throwing spray',
      shotIndex: 2,
      shotCount: 4,
      durationSeconds: 8,
      continuesFromFrame: true
    });
    expect(first).toMatchObject({ success: true });
    const prompt = (first as { prompt: string }).prompt;
    expect(prompt).toContain('Close on the front wheel throwing spray');
    expect(prompt).toContain('Shot 2 of 4, 8s.');

    const refined = server.composeShotPrompt({ previousPrompt: prompt, change: 'Slower camera move' });
    expect(refined).toMatchObject({ success: true, revisions: ['Slower camera move'] });
    // The take being refined is still described in full: a rewrite would lose
    // the wardrobe, lens and location nobody mentioned in the note.
    expect((refined as { prompt: string }).prompt).toContain('Close on the front wheel throwing spray');

    // Half a refinement is refused rather than guessed at.
    expect(server.composeShotPrompt({ previousPrompt: prompt })).toMatchObject({ success: false });
    expect(server.composeShotPrompt({})).toMatchObject({ success: false });
  });
});
