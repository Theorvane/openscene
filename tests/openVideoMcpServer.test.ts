import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fail, ok } from '../src/main/ipcResponses';
import { getOpenVideoMcpDefinition, OpenVideoMcpServer } from '../src/main/openVideoMcpServer';
import { ProjectStore } from '../src/main/projectStore';
import type { MediaAsset } from '../src/shared/timelineTypes';

describe('OpenVideo TypeMCP Server and Tool declarations', () => {
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
    expect(toolNames).toContain('createVideoJob');
    expect(toolNames).toContain('createSpeechJob');
    expect(toolNames).toContain('getJobStatus');
    expect(toolNames).toContain('addClipToTimeline');
    expect(toolNames).toContain('exportProjectVideo');
  });

  it('executes createVideoJob MCP tool and returns job metadata', async () => {
    const server = new OpenVideoMcpServer();
    const result = await server.createVideoJob({
      prompt: 'Cinematic intro shot of Seoul skyline',
      aspectRatio: '16:9',
      durationSeconds: 5,
      mode: 'local'
    });

    expect(result.success).toBe(true);
    const okResult = result as { success: true; jobId: string; mode: string; provider: string };
    expect(okResult.jobId.length).toBeGreaterThan(0);
    expect(okResult.mode).toBe('local');
    expect(okResult.provider).toBe('local_video');
  });

  it('rejects createVideoJob with api mode and returns not-implemented error', async () => {
    const server = new OpenVideoMcpServer();
    const result = await server.createVideoJob({
      prompt: 'Cinematic intro shot of Seoul skyline',
      mode: 'api',
      apiKey: 'sk-test-valid-key-12345'
    });

    expect(result.success).toBe(false);
    const errResult = result as { success: false; error: string };
    expect(errResult.error).toContain('not yet implemented');
  });

  it('rejects createSpeechJob with api mode and returns not-implemented error', async () => {
    const server = new OpenVideoMcpServer();
    const result = await server.createSpeechJob({
      script: 'Hello from cloud speech',
      mode: 'api',
      apiKey: 'el-test-key-12345'
    });

    expect(result.success).toBe(false);
    const errResult = result as { success: false; error: string };
    expect(errResult.error).toContain('not yet implemented');
  });

  it('executes createSpeechJob MCP tool and returns speech job metadata', async () => {
    const server = new OpenVideoMcpServer();
    const result = await server.createSpeechJob({
      script: 'Welcome to OpenVideo desktop suite',
      voiceId: 'qwen-narrator',
      mode: 'local'
    });

    expect(result.success).toBe(true);
    const okResult = result as { success: true; jobId: string; mode: string };
    expect(okResult.jobId.length).toBeGreaterThan(0);
    expect(okResult.mode).toBe('local');
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

    // 3. Missing track
    const noTrackResult = await server.addClipToTimeline({
      projectId: project.id,
      trackId: 'track-invalid',
      assetId: 'asset-123',
      startOffsetSeconds: 0,
      durationSeconds: 5
    });
    expect(noTrackResult.success).toBe(false);
    expect(noTrackResult.error).toContain('Track track-invalid not found');

    // 4. Missing asset
    const validTrackId = project.timeline.tracks[0]!.id;
    const noAssetResult = await server.addClipToTimeline({
      projectId: project.id,
      trackId: validTrackId,
      assetId: 'asset-invalid',
      startOffsetSeconds: 0,
      durationSeconds: 5
    });
    expect(noAssetResult.success).toBe(false);
    expect(noAssetResult.error).toContain('Asset asset-invalid not found');
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

  it('validates exportProjectVideo error propagation when export service fails or succeeds', async () => {
    const server = new OpenVideoMcpServer();

    // 1. Missing ExportIpcService
    const noExportServiceResult = await server.exportProjectVideo({
      projectId: 'proj-123',
      preset: 'high'
    });
    expect(noExportServiceResult.success).toBe(false);
    expect(noExportServiceResult.error).toContain('Export service is not available');

    // 2. Mock failing ExportIpcService
    const mockFailingExportService = {
      startExportJob: async () => fail('UNKNOWN_ERROR', 'FFmpeg binary not found')
    } as any;

    server.setServices(projectStore, mockFailingExportService);
    const failResult = await server.exportProjectVideo({
      projectId: 'proj-123',
      preset: 'high'
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
      projectId: 'proj-123',
      preset: 'high'
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
      durationSeconds: 5,
      mode: 'local'
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
});
