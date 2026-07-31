import { randomUUID } from 'node:crypto';
import { resolve as resolvePath, sep } from 'node:path';
import { getMcpServerDefinition, McpResource, McpServer, McpTool } from '@theorvane/type-mcp';
import { z } from 'zod';
import { CLIP_EFFECT_RANGES, DEFAULT_CLIP_EFFECTS, type ClipEffects, type TimelineTrack } from '../shared/timelineTypes';
import { deleteClip, placeClip } from '../shared/timelineClipLogic';
import { resolveTimelineTrackForAsset, trackAppendStartMs } from '../shared/timelineClipPlacement';
import type { ExportIpcService } from './exportIpcService';
import type { ResultAssetImportService } from './resultAssetImportService';
import type { ProjectStore } from './projectStore';
import { discoverFfmpeg } from './ffmpegDiscovery';
import {
  extractVideoFrames,
  formatFrameTimestamp,
  planFrameTimestamps,
  WATCH_FRAME_HARD_CAP,
  type ExtractedFrame
} from './videoFrameAnalysis';
import { estimateVideoPlanCost, formatCostEstimate, estimateImageCost, estimateSpeechCost } from '../shared/mediaGenerationPricing';
import { MAX_SUPPORTED_SHOT_SECONDS, planVideoStoryboard, supportedShotSeconds } from '../shared/videoStoryboardPlan';
import { checkNarrationFit, narrationBudget, detectScriptKind } from '../shared/narrationTiming';
import { getDomainModel, getDefaultDomainModelId } from '../shared/aiDomainModels';
import {
  getGeneratedImageAsReference,
  createImageGenerationJob,
  createSpeechGenerationJob,
  createVideoGenerationJob,
  getImageGenerationJob,
  getSpeechGenerationJob,
  getVideoGenerationJob
} from './aiJobManager';

/** Clip length used only when an asset has no probed duration yet. */
const FALLBACK_CLIP_DURATION_MS = 5_000;

/** Injectable frame extractor so tests never need a real FFmpeg runtime. */
export type WatchFrameExtractor = (input: {
  readonly filePath: string;
  readonly timestampsMs: readonly number[];
}) => Promise<readonly ExtractedFrame[]>;

async function defaultWatchFrameExtractor(input: {
  readonly filePath: string;
  readonly timestampsMs: readonly number[];
}): Promise<readonly ExtractedFrame[]> {
  const ffmpeg = await discoverFfmpeg();
  if (ffmpeg.kind === 'unavailable') {
    throw new Error(`FFmpeg is unavailable: ${ffmpeg.reason}`);
  }
  return extractVideoFrames({ ffmpegPath: ffmpeg.executablePath, filePath: input.filePath, timestampsMs: input.timestampsMs });
}

@McpServer({ name: 'openvideo-mcp-server', version: '0.1.0' })
export class OpenVideoMcpServer {
  private projectStore: ProjectStore | undefined;
  private exportIpcService: ExportIpcService | undefined;
  private watchFrameExtractor: WatchFrameExtractor = defaultWatchFrameExtractor;
  private resultImports: ResultAssetImportService | undefined;
  private notifyProjectTimelineChanged: ((projectId: string) => void) | undefined;

  /**
   * Agent tools write straight to the project store, so an editor that already
   * has the project open would keep showing — and later save over — its stale
   * copy. The host passes a notifier that tells open windows to reload.
   */
  public setProjectTimelineChangeNotifier(notify: (projectId: string) => void): void {
    this.notifyProjectTimelineChanged = notify;
  }

  public setServices(
    projectStore?: ProjectStore | undefined,
    exportIpcService?: ExportIpcService | undefined,
    watchFrameExtractor?: WatchFrameExtractor | undefined
  ): void {
    this.projectStore = projectStore;
    this.exportIpcService = exportIpcService;
    this.watchFrameExtractor = watchFrameExtractor ?? defaultWatchFrameExtractor;
  }

  /** Lets the agent finish a generation by importing its result, as the UI does. */
  public setResultImportService(resultImports: ResultAssetImportService): void {
    this.resultImports = resultImports;
  }

  @McpTool({
    description:
      'Check a narration script against the seconds it has to fill, before paying for speech. Returns an ' +
      'estimated duration, a verdict, and a word or character budget. Never estimate narration length ' +
      'yourself: an over-running script is only discovered after the speech job was billed and placed. ' +
      'Read-only, spends nothing.',
    input: z.object({
      script: z.string().min(1),
      targetSeconds: z.number().min(0),
      pace: z.enum(['measured', 'natural', 'brisk']).optional()
    })
  })
  checkNarrationLength(params: { script: string; targetSeconds: number; pace?: 'measured' | 'natural' | 'brisk' }) {
    const fit = checkNarrationFit({
      script: params.script,
      targetSeconds: params.targetSeconds,
      ...(params.pace === undefined ? {} : { pace: params.pace })
    });
    const budget = narrationBudget({
      targetSeconds: params.targetSeconds,
      kind: detectScriptKind(params.script),
      ...(params.pace === undefined ? {} : { pace: params.pace })
    });
    return {
      success: true,
      verdict: fit.verdict,
      estimatedSeconds: fit.estimate.estimatedSeconds,
      targetSeconds: fit.targetSeconds,
      deltaSeconds: fit.deltaSeconds,
      countedAs: fit.estimate.kind,
      units: fit.estimate.units,
      budgetUnits: budget.units,
      pace: fit.estimate.pace,
      message: fit.advice
    };
  }

  @McpTool({
    description:
      'Split a total video length into shots the provider accepts. Returns legal per-shot durations, start ' +
      'times, continuity fields to repeat in every shot prompt. Call before writing a scenario. Never compute ' +
      'shot lengths yourself: an illegal duration is rejected only after the user approved the spend. ' +
      'Read-only, spends nothing.',
    input: z.object({
      totalSeconds: z.number().min(1),
      modelId: z.string().optional().describe('Video model the shots will be rendered with.')
    })
  })
  planVideoScenario(params: { totalSeconds: number; modelId?: string }) {
    const modelId = params.modelId ?? getDefaultDomainModelId('video-generation');
    const model = getDomainModel('video-generation', modelId);
    if (model === undefined) {
      return { success: false, error: `Model ${modelId} is not a video-generation model.` };
    }

    const plan = planVideoStoryboard({ totalSeconds: params.totalSeconds, providerId: model.providerId });
    return {
      success: true,
      modelId,
      providerLabel: model.providerLabel,
      supportedShotSeconds: supportedShotSeconds(model.providerId),
      totalSeconds: plan.totalSeconds,
      requestedSeconds: plan.requestedSeconds,
      roundedFrom: plan.roundedFrom,
      shots: plan.shots,
      continuityKeys: plan.continuityKeys,
      message:
        (plan.roundedFrom === undefined
          ? `${plan.shots.length} shot(s) totalling ${plan.totalSeconds}s.`
          : `${plan.shots.length} shot(s) totalling ${plan.totalSeconds}s; ${plan.roundedFrom}s was not reachable from this model's shot lengths. Tell the user the length changed.`) +
        ' Write one description per shot, repeating every continuity field in each. Then price the whole list with estimateGenerationCost.'
    };
  }

  @McpTool({
    description:
      'Price a generation plan. Call before createVideoJob, createImageJob, createSpeechJob; show result to ' +
      'user. Read-only, spends nothing. Never state a price you did not get from this tool: recalled figures ' +
      'are not real prices. Shot comes back unpriced: say so, ask user to confirm unknown charge.',
    input: z.object({
      kind: z.enum(['video', 'image', 'speech']),
      shots: z
        .array(z.object({ modelId: z.string().min(1), durationSeconds: z.number() }))
        .optional()
        .describe('Video only: one entry per shot in the planned scenario.'),
      modelId: z.string().optional().describe('Image and speech only.'),
      imageCount: z.number().optional().describe('Image only; defaults to 1.')
    })
  })
  estimateGenerationCost(params: {
    kind: 'video' | 'image' | 'speech';
    shots?: readonly { modelId: string; durationSeconds: number }[];
    modelId?: string;
    imageCount?: number;
  }) {
    if (params.kind === 'video') {
      const shots = params.shots ?? [];
      if (shots.length === 0) {
        return { success: false, error: 'Video estimates need at least one shot with a modelId and durationSeconds.' };
      }
      const plan = estimateVideoPlanCost(shots);
      return {
        success: true,
        kind: 'video',
        shots: plan.shots.map((estimate, index) => ({
          shot: index + 1,
          modelId: estimate.modelId,
          priced: estimate.priced,
          amountUsd: estimate.amountUsd,
          summary: formatCostEstimate(estimate)
        })),
        totalUsd: plan.totalUsd,
        fullyPriced: plan.fullyPriced,
        asOf: plan.asOf,
        message: plan.fullyPriced
          ? `Estimated total $${plan.totalUsd?.toFixed(2)} across ${plan.shots.length} shot(s). Show this to the user and wait for approval before generating.`
          : 'At least one shot could not be priced. Tell the user which, and ask them to confirm they accept an unknown charge before generating.'
      };
    }

    if (params.modelId === undefined || params.modelId.length === 0) {
      return { success: false, error: `${params.kind} estimates need a modelId.` };
    }

    const estimate =
      params.kind === 'image'
        ? estimateImageCost({ modelId: params.modelId, imageCount: params.imageCount ?? 1 })
        : estimateSpeechCost({ modelId: params.modelId });

    return {
      success: true,
      kind: params.kind,
      modelId: estimate.modelId,
      priced: estimate.priced,
      amountUsd: estimate.amountUsd,
      asOf: estimate.asOf,
      summary: formatCostEstimate(estimate),
      message: estimate.priced
        ? 'Show this to the user and wait for approval before generating.'
        : 'Cost is unknown. Ask the user to confirm they accept an unknown charge before generating.'
    };
  }

  @McpTool({
    description:
      'Create AI video generation job with the selected video-generation model. Runs against the provider ' +
      'connected in Settings; none connected fails with an explicit error.',
    input: z.object({
      prompt: z.string().min(1, 'Prompt is required'),
      aspectRatio: z.enum(['16:9', '9:16', '1:1']).default('16:9'),
      // Derived, not a literal: see MAX_SUPPORTED_SHOT_SECONDS.
      durationSeconds: z.number().min(1).max(MAX_SUPPORTED_SHOT_SECONDS).default(5),
      stylePreset: z.string().optional().default('Cinematic'),
      modelId: z.string().optional(),
      referenceImageJobId: z
        .string()
        .optional()
        .describe('A completed createImageJob id. Seeds image-to-video so the shot matches its still.'),
      apiKey: z.string().optional()
    })
  })
  async createVideoJob(params: {
    prompt: string;
    aspectRatio?: '16:9' | '9:16' | '1:1';
    durationSeconds?: number;
    stylePreset?: string;
    modelId?: string;
    referenceImageJobId?: string;
    apiKey?: string;
  }) {
    // The still crosses as inline bytes, exactly as a picked file would, so
    // image-to-video does not care that this seed was generated.
    let referenceImage: { displayName: string; mimeType: string; base64: string } | undefined;
    if (params.referenceImageJobId !== undefined) {
      const resolved = getGeneratedImageAsReference(params.referenceImageJobId);
      if (resolved === null) {
        return {
          success: false,
          error: `Image job ${params.referenceImageJobId} has no completed image to use as a reference.`
        };
      }
      referenceImage = { ...resolved };
    }

    const job = await createVideoGenerationJob({
      prompt: params.prompt,
      aspectRatio: params.aspectRatio ?? '16:9',
      durationSeconds: params.durationSeconds ?? 5,
      stylePreset: params.stylePreset ?? 'Cinematic',
      ...(params.modelId === undefined ? {} : { modelId: params.modelId }),
      ...(referenceImage === undefined ? {} : { referenceImage })
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
      'Create AI speech job with the selected voice-generation model. Runs against the provider connected ' +
      'in Settings; none connected fails with an explicit error.',
    input: z.object({
      script: z.string().min(1, 'Script is required'),
      voiceId: z.string().default(''),
      modelId: z.string().optional(),
      apiKey: z.string().optional()
    })
  })
  async createSpeechJob(params: {
    script: string;
    voiceId?: string;
    modelId?: string;
    apiKey?: string;
  }) {
    const job = await createSpeechGenerationJob({
      script: params.script,
      voiceId: params.voiceId ?? '',
      ...(params.modelId === undefined ? {} : { modelId: params.modelId })
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
    description:
      'Generate a still image from a text prompt using the configured cloud image model. Useful for poster frames, title cards, and as a seed for image-to-video generation.',
    input: z.object({
      prompt: z.string().min(1),
      aspectRatio: z.enum(['1:1', '16:9', '9:16', '4:3', '3:4']).default('1:1'),
      negativePrompt: z.string().optional(),
      modelId: z.string().optional()
    })
  })
  async createImageJob(params: {
    prompt: string;
    aspectRatio?: '1:1' | '16:9' | '9:16' | '4:3' | '3:4';
    negativePrompt?: string;
    modelId?: string;
  }) {
    const job = await createImageGenerationJob({
      prompt: params.prompt,
      aspectRatio: params.aspectRatio ?? '1:1',
      ...(params.negativePrompt === undefined ? {} : { negativePrompt: params.negativePrompt }),
      ...(params.modelId === undefined ? {} : { modelId: params.modelId })
    });

    return {
      success: true,
      jobId: job.id,
      status: job.status,
      mode: job.mode,
      provider: job.provider,
      message: `AI image job created: ${job.id}`
    };
  }

  @McpTool({
    description: 'Check status of an AI video, speech, or image generation job.',
    input: z.object({
      jobId: z.string().min(1),
      kind: z.enum(['video', 'speech', 'image'])
    })
  })
  async getJobStatus(params: { jobId: string; kind: 'video' | 'speech' | 'image' }) {
    const job =
      params.kind === 'video'
        ? getVideoGenerationJob(params.jobId)
        : params.kind === 'image'
          ? getImageGenerationJob(params.jobId)
          : getSpeechGenerationJob(params.jobId);
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
    description: 'Inspect an OpenScene project timeline and safe asset metadata for edit planning. This is read-only and never returns filesystem paths or credentials.',
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
    description:
      'Watch a project video asset: samples a small set of frames across the video (or a focused startMs–endMs section) ' +
      'so the model can see what is on screen. Read-only. The frames are attached to the conversation as images with ' +
      'timestamps — describe or reason about them after they arrive. Use a vision-capable model to actually see them.',
    input: z.object({
      projectId: z.string().min(1),
      assetId: z.string().min(1),
      startMs: z.number().finite().min(0).optional(),
      endMs: z.number().finite().min(0).optional(),
      maxFrames: z.number().int().min(1).max(WATCH_FRAME_HARD_CAP).optional()
    })
  })
  async watchProjectVideo(params: {
    projectId: string;
    assetId: string;
    startMs?: number;
    endMs?: number;
    maxFrames?: number;
  }) {
    if (!this.projectStore) {
      return { success: false as const, error: 'ProjectStore service is not available.' };
    }

    try {
      const project = await this.projectStore.open(params.projectId);
      if (!project) {
        return { success: false as const, error: `Project ${params.projectId} not found.` };
      }
      const asset = project.assets.find((candidate) => candidate.id === params.assetId);
      if (!asset) {
        return { success: false as const, error: `Asset ${params.assetId} not found in project ${params.projectId}.` };
      }
      if (asset.kind !== 'video') {
        return { success: false as const, error: `Asset ${params.assetId} is ${asset.kind}, not video.` };
      }
      const durationMs = asset.metadata?.durationMs;
      if (durationMs === undefined || durationMs <= 0) {
        return { success: false as const, error: 'The asset has no duration metadata yet; open it in the editor to probe it first.' };
      }

      const timestampsMs = planFrameTimestamps({
        durationMs,
        startMs: params.startMs,
        endMs: params.endMs,
        maxFrames: params.maxFrames
      });
      if (timestampsMs.length === 0) {
        return { success: false as const, error: 'The requested range contains nothing to sample.' };
      }

      // Confinement: the asset file must stay inside its resolved project folder.
      const projectDirectory = await this.projectStore.resolveDirectory(params.projectId);
      const filePath = resolvePath(projectDirectory, asset.projectRelativePath);
      if (!filePath.startsWith(`${projectDirectory}${sep}`)) {
        return { success: false as const, error: 'The asset path escapes the project folder and was refused.' };
      }

      let frames: readonly ExtractedFrame[];
      try {
        frames = await this.watchFrameExtractor({ filePath, timestampsMs });
      } catch {
        // Extraction errors can carry filesystem paths in FFmpeg stderr; keep the tool result path-free.
        return { success: false as const, error: 'FFmpeg could not extract frames from this asset. Check FFmpeg readiness in Settings → Local Tools.' };
      }
      if (frames.length === 0) {
        return { success: false as const, error: 'FFmpeg produced no frames for the requested range.' };
      }

      return {
        success: true as const,
        projectId: params.projectId,
        assetId: asset.id,
        displayName: asset.displayName,
        durationMs,
        frameCount: frames.length,
        summary:
          `Sampled ${frames.length} frames from "${asset.displayName}" at ` +
          `${frames.map((frame) => formatFrameTimestamp(frame.timeMs)).join(', ')}. ` +
          'The frames are attached to the conversation as images in chronological order.',
        frames: frames.map((frame) => ({
          timeMs: frame.timeMs,
          timestamp: formatFrameTimestamp(frame.timeMs),
          jpegBase64: frame.jpegBase64
        }))
      };
    } catch (err) {
      return {
        success: false as const,
        error: err instanceof Error ? err.message : `Failed to watch asset ${params.assetId}.`
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
      this.notifyProjectTimelineChanged?.(params.projectId);
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
    description:
      'Remove one clip from a project timeline. This changes a saved project and requires explicit user approval. ' +
      'Transitions that referenced the clip are dropped with it.',
    input: z.object({
      projectId: z.string().min(1),
      clipId: z.string().min(1)
    })
  })
  async removeTimelineClip(params: { projectId: string; clipId: string }) {
    if (!this.projectStore) {
      return { success: false as const, error: 'ProjectStore service is not available.' };
    }

    try {
      const project = await this.projectStore.open(params.projectId);
      if (!project) {
        return { success: false as const, error: `Project ${params.projectId} not found.` };
      }

      // deleteClip returns the timeline unchanged for an unknown id, so compare
      // rather than reporting success for a no-op.
      const nextTimeline = deleteClip(project.timeline, params.clipId);
      if (nextTimeline === project.timeline) {
        return { success: false as const, error: `Clip ${params.clipId} is not on the timeline of project ${params.projectId}.` };
      }

      await this.projectStore.saveTimeline(params.projectId, nextTimeline);
      this.notifyProjectTimelineChanged?.(params.projectId);

      return {
        success: true as const,
        projectId: params.projectId,
        clipId: params.clipId,
        message: `Removed clip ${params.clipId} from project ${params.projectId}`
      };
    } catch (err) {
      return {
        success: false as const,
        error: err instanceof Error ? err.message : `Failed to remove clip ${params.clipId}`
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
      this.notifyProjectTimelineChanged?.(params.projectId);
      return { success: true, projectId: params.projectId, clipId: params.clipId, effects: params.effects };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : `Failed to update effects for clip ${params.clipId}` };
    }
  }

  @McpTool({
    description:
      'Add a project asset to the timeline as a clip. Omit trackId to place it on the first track ' +
      'matching the asset kind, omit startOffsetSeconds to append after the last clip on that track, ' +
      'and omit durationSeconds to use the whole asset.',
    input: z.object({
      projectId: z.string().min(1),
      assetId: z.string().min(1),
      trackId: z.string().min(1).optional(),
      startOffsetSeconds: z.number().min(0).optional(),
      durationSeconds: z.number().min(0.1).optional()
    })
  })
  async addClipToTimeline(params: {
    projectId: string;
    assetId: string;
    trackId?: string | undefined;
    startOffsetSeconds?: number | undefined;
    durationSeconds?: number | undefined;
  }) {
    if (!this.projectStore) {
      return { success: false, error: 'ProjectStore service is not available.' };
    }

    try {
      const project = await this.projectStore.open(params.projectId);
      if (!project) {
        return { success: false, error: `Project ${params.projectId} not found.` };
      }

      const asset = project.assets.find((a) => a.id === params.assetId);
      if (!asset) {
        return { success: false, error: `Asset ${params.assetId} not found in project ${params.projectId}.` };
      }

      const target = resolveTimelineTrackForAsset(project.timeline, asset, params.trackId);
      if (!target.ok) {
        return { success: false, error: target.error };
      }
      const targetTrack = target.track;

      const clipId = `clip-${randomUUID()}`;
      const assetDurationMs = asset.metadata?.durationMs;
      const durationMs = params.durationSeconds !== undefined
        ? params.durationSeconds * 1000
        : assetDurationMs ?? FALLBACK_CLIP_DURATION_MS;
      const timelineStartMs = params.startOffsetSeconds !== undefined
        ? params.startOffsetSeconds * 1000
        : trackAppendStartMs(targetTrack);

      const newClip = {
        id: clipId,
        assetId: params.assetId,
        timelineStartMs,
        sourceStartMs: 0,
        sourceEndMs: assetDurationMs === undefined ? durationMs : Math.min(durationMs, assetDurationMs),
        sourceDurationMs: assetDurationMs ?? durationMs,
        effects: DEFAULT_CLIP_EFFECTS,
        keyframes: []
      };

      // The same placement rules the editor uses, so an agent edit can never
      // write a clip the UI would reject (overlaps, out-of-range source range).
      const nextTimeline = placeClip(project.timeline, { trackId: targetTrack.id, clip: newClip });
      if (nextTimeline === null) {
        return {
          success: false,
          error: `Could not place the clip at ${timelineStartMs / 1000}s on track ${targetTrack.id} — it would overlap an existing clip or fall outside the asset. Read the timeline first and pick a free range.`
        };
      }

      await this.projectStore.saveTimeline(params.projectId, nextTimeline);
      this.notifyProjectTimelineChanged?.(params.projectId);

      return {
        success: true,
        clipId,
        projectId: params.projectId,
        trackId: targetTrack.id,
        assetId: params.assetId,
        startOffsetSeconds: timelineStartMs / 1000,
        durationSeconds: (newClip.sourceEndMs - newClip.sourceStartMs) / 1000,
        message: `Added clip ${clipId} to track ${targetTrack.id} in project ${params.projectId}`
      };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : `Failed to add clip to project ${params.projectId}`
      };
    }
  }

  @McpTool({
    description:
      'Import a completed voice or video generation job into the project as an asset. ' +
      'Call this after getJobStatus reports the job completed; the returned assetId can then ' +
      'be placed with addClipToTimeline.',
    input: z.object({
      projectId: z.string().min(1),
      jobId: z.string().min(1)
    })
  })
  async importGeneratedResult(params: { projectId: string; jobId: string }) {
    if (!this.resultImports) {
      return { success: false as const, error: 'Result import service is not available.' };
    }

    const response = await this.resultImports.importAiResult({ projectId: params.projectId, jobId: params.jobId });
    if (!response.ok) {
      return { success: false as const, error: response.error.message };
    }

    const assets = response.value.assets.map((asset) => ({
      id: asset.id,
      displayName: asset.displayName,
      kind: asset.kind,
      durationMs: asset.metadata?.durationMs
    }));
    // The project gained an asset, so an open editor must reload to see it.
    this.notifyProjectTimelineChanged?.(params.projectId);

    return {
      success: true as const,
      projectId: params.projectId,
      jobId: params.jobId,
      assets,
      message: `Imported ${assets.length} generated asset(s) into project ${params.projectId}.`
    };
  }

  @McpTool({
    // No quality parameter: the export pipeline has no preset concept
    // (StartExportJobInput carries only size and frame rate), and the tool used
    // to accept one, drop it, and echo it back as if it had applied.
    description: 'Start FFmpeg MP4 export for an OpenScene project timeline. Exports at the project settings; there is no quality preset.',
    input: z.object({
      projectId: z.string().min(1)
    })
  })
  async exportProjectVideo(params: { projectId: string }) {
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
    description: 'OpenScene MCP Server Capability Descriptor'
  })
  readCapabilities() {
    return {
      server: 'openvideo-mcp-server',
      version: '0.1.0',
      tools: ['planVideoScenario', 'checkNarrationLength', 'estimateGenerationCost', 'createVideoJob', 'createSpeechJob', 'createImageJob', 'getJobStatus', 'importGeneratedResult', 'getProjectTimeline', 'watchProjectVideo', 'trimTimelineClip', 'updateClipEffects', 'addClipToTimeline', 'removeTimelineClip', 'exportProjectVideo']
    };
  }
}

export function getOpenVideoMcpDefinition() {
  return getMcpServerDefinition(OpenVideoMcpServer);
}
