import { randomUUID } from 'node:crypto';
import { getMcpServerDefinition, McpResource, McpServer, McpTool } from '@theorvane/type-mcp';
import { z } from 'zod';
import { CLIP_EFFECT_RANGES, DEFAULT_CLIP_EFFECTS, type ClipEffects, type TimelineTrack } from '../shared/timelineTypes';
import type { ExportIpcService } from './exportIpcService';
import type { ProjectStore } from './projectStore';
import {
  createSpeechGenerationJob,
  createVideoGenerationJob,
  getSpeechGenerationJob,
  getVideoGenerationJob
} from './aiJobManager';

@McpServer({ name: 'openvideo-mcp-server', version: '0.1.0' })
export class OpenVideoMcpServer {
  private projectStore: ProjectStore | undefined;
  private exportIpcService: ExportIpcService | undefined;

  public setServices(projectStore?: ProjectStore | undefined, exportIpcService?: ExportIpcService | undefined): void {
    this.projectStore = projectStore;
    this.exportIpcService = exportIpcService;
  }

  @McpTool({
    description:
      'Create an AI video generation job using a locally configured runner. ' +
      'Only mode="local" is supported; cloud API providers (Gemini Veo, OpenAI Sora, Runway, Kling, Luma) ' +
      'are not yet implemented and will return an error.',
    input: z.object({
      prompt: z.string().min(1, 'Prompt is required'),
      aspectRatio: z.enum(['16:9', '9:16', '1:1']).default('16:9'),
      durationSeconds: z.number().min(1).max(10).default(5),
      stylePreset: z.string().optional().default('Cinematic'),
      mode: z.enum(['local', 'api']).default('local'),
      provider: z.enum(['local_video', 'gemini_veo', 'openai_sora', 'runway_gen4', 'kling_v3', 'luma_dream']).optional(),
      apiKey: z.string().optional()
    })
  })
  async createVideoJob(params: {
    prompt: string;
    aspectRatio?: '16:9' | '9:16' | '1:1';
    durationSeconds?: number;
    stylePreset?: string;
    mode?: 'local' | 'api';
    provider?: 'local_video' | 'gemini_veo' | 'openai_sora' | 'runway_gen4' | 'kling_v3' | 'luma_dream';
    apiKey?: string;
  }) {
    if (params.mode === 'api') {
      return {
        success: false,
        error:
          'Cloud API video generation is not yet implemented. ' +
          'Use mode="local" with a configured local runner (VIDEO_TOOL_LOCAL_VIDEO_RUNNER_PATH).'
      };
    }

    const job = await createVideoGenerationJob({
      prompt: params.prompt,
      aspectRatio: params.aspectRatio ?? '16:9',
      durationSeconds: params.durationSeconds ?? 5,
      stylePreset: params.stylePreset ?? 'Cinematic',
      mode: 'local'
    });

    return {
      success: true,
      jobId: job.id,
      status: job.status,
      mode: job.mode,
      provider: job.provider,
      message: `AI video job created: ${job.id}`
    };
  }

  @McpTool({
    description:
      'Create an AI voiceover/speech synthesis job using the local Qwen TTS runner. ' +
      'Only mode="local" is supported; ElevenLabs cloud API speech synthesis is not yet implemented.',
    input: z.object({
      script: z.string().min(1, 'Script is required'),
      voiceId: z.string().default('qwen-neutral'),
      mode: z.enum(['local', 'api']).default('local'),
      apiKey: z.string().optional()
    })
  })
  async createSpeechJob(params: {
    script: string;
    voiceId?: string;
    mode?: 'local' | 'api';
    apiKey?: string;
  }) {
    if (params.mode === 'api') {
      return {
        success: false,
        error:
          'ElevenLabs cloud speech synthesis is not yet implemented. ' +
          'Use mode="local" with a configured Qwen TTS runner (VIDEO_TOOL_LOCAL_TTS_RUNNER_PATH).'
      };
    }

    const job = await createSpeechGenerationJob({
      script: params.script,
      voiceId: params.voiceId ?? 'qwen-neutral',
      mode: 'local'
    });

    return {
      success: true,
      jobId: job.id,
      status: job.status,
      mode: job.mode,
      provider: job.provider,
      message: `AI speech job created: ${job.id}`
    };
  }

  @McpTool({
    description: 'Check status of an AI video or speech generation job.',
    input: z.object({
      jobId: z.string().min(1),
      kind: z.enum(['video', 'speech'])
    })
  })
  async getJobStatus(params: { jobId: string; kind: 'video' | 'speech' }) {
    const job = params.kind === 'video' ? getVideoGenerationJob(params.jobId) : getSpeechGenerationJob(params.jobId);
    if (!job) {
      return { success: false, error: `Job ${params.jobId} not found.` };
    }
    return {
      success: true,
      jobId: job.id,
      status: job.status,
      outputFilePath: job.outputFilePath,
      error: job.error
    };
  }

  @McpTool({
    description: 'Inspect an OpenVideo project timeline and safe asset metadata for edit planning. This is read-only and never returns filesystem paths or credentials.',
    input: z.object({
      projectId: z.string().min(1)
    })
  })
  async getProjectTimeline(params: { projectId: string }) {
    if (!this.projectStore) {
      return { success: false, error: 'ProjectStore service is not available.' };
    }

    try {
      const project = await this.projectStore.open(params.projectId);
      if (!project) {
        return { success: false, error: `Project ${params.projectId} not found.` };
      }

      return {
        success: true,
        project: {
          id: project.id,
          name: project.name,
          assets: project.assets.map((asset) => ({
            id: asset.id,
            displayName: asset.displayName,
            kind: asset.kind,
            mimeType: asset.mimeType,
            durationMs: asset.metadata?.durationMs
          })),
          timeline: {
            tracks: project.timeline.tracks.map((track) => ({
              id: track.id,
              kind: track.kind,
              clips: track.clips.map((clip) => ({
                id: clip.id,
                assetId: clip.assetId,
                timelineStartMs: clip.timelineStartMs,
                sourceStartMs: clip.sourceStartMs,
                sourceEndMs: clip.sourceEndMs
              }))
            }))
          }
        }
      };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : `Failed to inspect project ${params.projectId}`
      };
    }
  }

  @McpTool({
    description: 'Trim an existing timeline clip to a validated source range. This changes a saved project and requires explicit user approval.',
    input: z.object({
      projectId: z.string().min(1),
      clipId: z.string().min(1),
      sourceStartMs: z.number().finite().min(0),
      sourceEndMs: z.number().finite().min(0)
    })
  })
  async trimTimelineClip(params: {
    projectId: string;
    clipId: string;
    sourceStartMs: number;
    sourceEndMs: number;
  }) {
    if (!this.projectStore) {
      return { success: false, error: 'ProjectStore service is not available.' };
    }
    if (params.sourceEndMs <= params.sourceStartMs) {
      return { success: false, error: 'sourceEndMs must be greater than sourceStartMs.' };
    }

    try {
      const project = await this.projectStore.open(params.projectId);
      if (!project) {
        return { success: false, error: `Project ${params.projectId} not found.` };
      }

      let found = false;
      let rangeError: string | undefined;
      const tracks: TimelineTrack[] = project.timeline.tracks.map((track) => ({
        ...track,
        clips: track.clips.map((clip) => {
          if (clip.id !== params.clipId) return clip;
          found = true;
          if (params.sourceEndMs > clip.sourceDurationMs) {
            rangeError = `Trim range exceeds source duration for clip ${params.clipId}.`;
            return clip;
          }
          return { ...clip, sourceStartMs: params.sourceStartMs, sourceEndMs: params.sourceEndMs };
        })
      }));

      if (!found) {
        return { success: false, error: `Clip ${params.clipId} not found in project ${params.projectId}.` };
      }
      if (rangeError !== undefined) {
        return { success: false, error: rangeError };
      }

      await this.projectStore.saveTimeline(params.projectId, { ...project.timeline, tracks });
      return {
        success: true,
        projectId: params.projectId,
        clipId: params.clipId,
        sourceStartMs: params.sourceStartMs,
        sourceEndMs: params.sourceEndMs,
        message: `Trimmed clip ${params.clipId} in project ${params.projectId}`
      };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : `Failed to trim clip ${params.clipId}`
      };
    }
  }

  @McpTool({
    description: 'Update validated basic effects on one timeline clip. This changes a saved project and requires explicit user approval.',
    input: z.object({
      projectId: z.string().min(1),
      clipId: z.string().min(1),
      effects: z.object({
        opacity: z.number().finite().min(CLIP_EFFECT_RANGES.opacity.min).max(CLIP_EFFECT_RANGES.opacity.max).optional(),
        scale: z.number().finite().min(CLIP_EFFECT_RANGES.scale.min).max(CLIP_EFFECT_RANGES.scale.max).optional(),
        positionX: z.number().finite().min(CLIP_EFFECT_RANGES.positionX.min).max(CLIP_EFFECT_RANGES.positionX.max).optional(),
        positionY: z.number().finite().min(CLIP_EFFECT_RANGES.positionY.min).max(CLIP_EFFECT_RANGES.positionY.max).optional(),
        rotation: z.number().finite().min(CLIP_EFFECT_RANGES.rotation.min).max(CLIP_EFFECT_RANGES.rotation.max).optional(),
        volume: z.number().finite().min(CLIP_EFFECT_RANGES.volume.min).max(CLIP_EFFECT_RANGES.volume.max).optional()
      }).refine((effects) => Object.keys(effects).length > 0, 'At least one effect must be provided.')
    })
  })
  async updateClipEffects(params: { projectId: string; clipId: string; effects: Partial<ClipEffects> }) {
    if (!this.projectStore) return { success: false, error: 'ProjectStore service is not available.' };
    const entries = Object.entries(params.effects) as readonly [keyof ClipEffects, number][];
    if (entries.length === 0) return { success: false, error: 'At least one effect must be provided.' };
    for (const [property, value] of entries) {
      const range = CLIP_EFFECT_RANGES[property];
      if (!Number.isFinite(value) || value < range.min || value > range.max) {
        return { success: false, error: `${property} must be between ${range.min} and ${range.max}.` };
      }
    }
    try {
      const project = await this.projectStore.open(params.projectId);
      if (!project) return { success: false, error: `Project ${params.projectId} not found.` };
      let found = false;
      const tracks: TimelineTrack[] = project.timeline.tracks.map((track) => ({
        ...track,
        clips: track.clips.map((clip) => {
          if (clip.id !== params.clipId) return clip;
          found = true;
          return { ...clip, effects: { ...(clip.effects ?? DEFAULT_CLIP_EFFECTS), ...params.effects } };
        })
      }));
      if (!found) return { success: false, error: `Clip ${params.clipId} not found in project ${params.projectId}.` };
      await this.projectStore.saveTimeline(params.projectId, { ...project.timeline, tracks });
      return { success: true, projectId: params.projectId, clipId: params.clipId, effects: params.effects };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : `Failed to update effects for clip ${params.clipId}` };
    }
  }

  @McpTool({
    description: 'Add a video or audio clip to a specific project timeline track.',
    input: z.object({
      projectId: z.string().min(1),
      trackId: z.string().min(1).default('video-1'),
      assetId: z.string().min(1),
      startOffsetSeconds: z.number().min(0).default(0),
      durationSeconds: z.number().min(1).default(5)
    })
  })
  async addClipToTimeline(params: {
    projectId: string;
    trackId: string;
    assetId: string;
    startOffsetSeconds: number;
    durationSeconds: number;
  }) {
    if (!this.projectStore) {
      return { success: false, error: 'ProjectStore service is not available.' };
    }

    try {
      const project = await this.projectStore.open(params.projectId);
      if (!project) {
        return { success: false, error: `Project ${params.projectId} not found.` };
      }

      const targetTrack = project.timeline.tracks.find((t) => t.id === params.trackId);
      if (!targetTrack) {
        return { success: false, error: `Track ${params.trackId} not found in project ${params.projectId}.` };
      }

      const asset = project.assets.find((a) => a.id === params.assetId);
      if (!asset) {
        return { success: false, error: `Asset ${params.assetId} not found in project ${params.projectId}.` };
      }

      const clipId = `clip-${randomUUID()}`;
      const durationMs = params.durationSeconds * 1000;
      const assetDurationMs = asset.metadata?.durationMs ?? durationMs;

      const newClip = {
        id: clipId,
        assetId: params.assetId,
        timelineStartMs: params.startOffsetSeconds * 1000,
        sourceStartMs: 0,
        sourceEndMs: Math.min(durationMs, assetDurationMs),
        sourceDurationMs: assetDurationMs,
        effects: DEFAULT_CLIP_EFFECTS,
        keyframes: []
      };

      const updatedTracks: TimelineTrack[] = project.timeline.tracks.map((t) =>
        t.id === params.trackId ? { ...t, clips: [...t.clips, newClip] } : t
      );

      await this.projectStore.saveTimeline(params.projectId, {
        ...project.timeline,
        tracks: updatedTracks
      });

      return {
        success: true,
        clipId,
        projectId: params.projectId,
        trackId: params.trackId,
        assetId: params.assetId,
        startOffsetSeconds: params.startOffsetSeconds,
        durationSeconds: params.durationSeconds,
        message: `Added clip ${clipId} to track ${params.trackId} in project ${params.projectId}`
      };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : `Failed to add clip to project ${params.projectId}`
      };
    }
  }

  @McpTool({
    description: 'Start FFmpeg MP4 export for an OpenVideo project timeline.',
    input: z.object({
      projectId: z.string().min(1),
      preset: z.enum(['fast', 'high', 'lossless']).default('high')
    })
  })
  async exportProjectVideo(params: { projectId: string; preset?: 'fast' | 'high' | 'lossless' }) {
    if (!this.exportIpcService) {
      return { success: false, error: 'Export service is not available.' };
    }

    try {
      const response = await this.exportIpcService.startExportJob({
        projectId: params.projectId
      });

      if (!response.ok) {
        return {
          success: false,
          error: response.error.message
        };
      }

      return {
        success: true,
        exportJobId: response.value.id,
        projectId: params.projectId,
        preset: params.preset ?? 'high',
        message: `Started FFmpeg export job ${response.value.id} for project ${params.projectId}`
      };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : `Failed to export project ${params.projectId}`
      };
    }
  }

  @McpResource({
    uri: 'openvideo://mcp-capabilities',
    mimeType: 'application/json',
    description: 'OpenVideo MCP Server Capability Descriptor'
  })
  readCapabilities() {
    return {
      server: 'openvideo-mcp-server',
      version: '0.1.0',
      tools: ['createVideoJob', 'createSpeechJob', 'getJobStatus', 'getProjectTimeline', 'trimTimelineClip', 'updateClipEffects', 'addClipToTimeline', 'exportProjectVideo']
    };
  }
}

export function getOpenVideoMcpDefinition() {
  return getMcpServerDefinition(OpenVideoMcpServer);
}
