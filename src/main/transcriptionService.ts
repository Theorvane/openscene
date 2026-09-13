import { randomUUID } from 'node:crypto';

import type { ApiResponse } from '../shared/models';
import type { SubtitleCue } from '../shared/narrationPlan';
import { parseStartTranscriptionInput, parseTranscriptionDraft, type TranscriptionJob, type WhisperCppRuntimeStatus } from '../shared/transcription';
import type { MediaAsset } from '../shared/timelineTypes';
import type { OpenedAssetPlaybackSource } from './assetLibraryStore';
import { discoverFfmpeg, type FfmpegDiscoveryResult } from './ffmpegDiscovery';
import { fail, ok } from './ipcResponses';
import { resolveWhisperCppRuntime, transcribeOpenedAsset, type WhisperCppRuntime } from './whisperCppAdapter';

type TranscriptionServiceDependencies = {
  readonly getAsset: (projectId: string, assetId: string) => Promise<MediaAsset | null>;
  readonly openAsset: (projectId: string, assetId: string) => Promise<OpenedAssetPlaybackSource | null>;
  readonly discoverFfmpeg?: () => Promise<FfmpegDiscoveryResult>;
  readonly resolveRuntime?: () => Promise<{ readonly status: WhisperCppRuntimeStatus; readonly runtime?: WhisperCppRuntime }>;
  readonly transcribe?: (input: {
    readonly source: OpenedAssetPlaybackSource;
    readonly sourceFileName: string;
    readonly ffmpegPath: string;
    readonly runtime: WhisperCppRuntime;
    readonly language: string;
    readonly signal: AbortSignal;
    readonly onStage: (stage: 'normalizing' | 'transcribing') => void;
    readonly onProgress: (percent: number) => void;
  }) => Promise<readonly SubtitleCue[]>;
};

export class TranscriptionService {
  private readonly jobs = new Map<string, TranscriptionJob>();
  private readonly controllers = new Map<string, AbortController>();

  constructor(private readonly dependencies: TranscriptionServiceDependencies) {}

  async runtimeStatus(): Promise<WhisperCppRuntimeStatus> {
    return (await (this.dependencies.resolveRuntime ?? resolveWhisperCppRuntime)()).status;
  }

  async start(payload: unknown): Promise<ApiResponse<TranscriptionJob>> {
    const input = parseStartTranscriptionInput(payload);
    if (input === null) return fail('INVALID_INPUT', 'The transcription request was not valid.');
    const id = `transcription-job-${Date.now()}-${randomUUID().slice(0, 8)}`;
    const now = new Date().toISOString();
    const job: TranscriptionJob = {
      id,
      projectId: input.projectId,
      sourceAssetId: input.assetId,
      status: 'queued',
      progressPercent: 0,
      createdAt: now,
      updatedAt: now
    };
    this.jobs.set(id, job);
    const controller = new AbortController();
    this.controllers.set(id, controller);
    this.log(id, 'request.queued', { projectId: input.projectId, assetId: input.assetId, language: input.language });
    setTimeout(() => void this.run(id, input, controller), 0);
    return ok(job);
  }

  get(jobId: string): TranscriptionJob | null {
    return this.jobs.get(jobId) ?? null;
  }

  cancel(jobId: string): ApiResponse<{ readonly cancelled: boolean }> {
    const job = this.jobs.get(jobId);
    if (job === undefined) return fail('JOB_NOT_FOUND', 'Transcription job was not found.');
    if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') return ok({ cancelled: false });
    this.controllers.get(jobId)?.abort();
    this.update(jobId, { status: 'cancelled', updatedAt: new Date().toISOString() });
    this.log(jobId, 'request.cancelled');
    return ok({ cancelled: true });
  }

  private update(jobId: string, patch: Partial<TranscriptionJob>): void {
    const current = this.jobs.get(jobId);
    if (current !== undefined) this.jobs.set(jobId, { ...current, ...patch });
  }

  private log(jobId: string, event: string, details: Readonly<Record<string, unknown>> = {}, level: 'info' | 'error' = 'info'): void {
    const suffix = Object.keys(details).length ? ` ${JSON.stringify(details)}` : '';
    console[level](`[OpenScene][Transcription][${jobId}] ${event}${suffix}`);
  }

  private async run(
    jobId: string,
    input: { readonly projectId: string; readonly assetId: string; readonly language: string },
    controller: AbortController
  ): Promise<void> {
    const startedAt = Date.now();
    let source: OpenedAssetPlaybackSource | null = null;
    let heartbeat: NodeJS.Timeout | undefined;
    try {
      const asset = await this.dependencies.getAsset(input.projectId, input.assetId);
      if (asset === null) throw new Error('The selected source asset is no longer available.');
      if (asset.kind !== 'audio' && asset.kind !== 'video') throw new Error('Automatic subtitles require an audio or video asset.');
      const [ffmpeg, whisper] = await Promise.all([
        (this.dependencies.discoverFfmpeg ?? discoverFfmpeg)(),
        (this.dependencies.resolveRuntime ?? resolveWhisperCppRuntime)()
      ]);
      if (ffmpeg.kind === 'unavailable') throw new Error(`${ffmpeg.reason} Configure VIDEO_TOOL_FFMPEG_PATH and restart OpenScene.`);
      if (!whisper.status.ready || whisper.runtime === undefined) throw new Error(whisper.status.reason ?? 'whisper.cpp is not ready.');
      source = await this.dependencies.openAsset(input.projectId, input.assetId);
      if (source === null) throw new Error('The selected source file is no longer available.');
      this.log(jobId, 'runtime.ready', {
        executable: whisper.runtime.executableName,
        model: whisper.runtime.modelName,
        checksumVerified: whisper.runtime.checksumVerified,
        sourceBytes: source.byteLength
      });
      heartbeat = setInterval(() => {
        const current = this.jobs.get(jobId);
        if (current === undefined || ['completed', 'failed', 'cancelled'].includes(current.status)) return;
        this.log(jobId, 'process.working', { stage: current.status, progressPercent: current.progressPercent, elapsedSeconds: Math.round((Date.now() - startedAt) / 1_000) });
      }, 10_000);
      const cues = await (this.dependencies.transcribe ?? transcribeOpenedAsset)({
        source,
        sourceFileName: asset.displayName,
        ffmpegPath: ffmpeg.executablePath,
        runtime: whisper.runtime,
        language: input.language,
        signal: controller.signal,
        onStage: (status) => {
          this.update(jobId, { status, updatedAt: new Date().toISOString() });
          this.log(jobId, `process.${status}`);
        },
        onProgress: (progressPercent) => this.update(jobId, { progressPercent, updatedAt: new Date().toISOString() })
      });
      if (controller.signal.aborted) return;
      const completedAt = new Date().toISOString();
      const draft = parseTranscriptionDraft({
        id: `transcript-${randomUUID()}`,
        sourceAssetId: input.assetId,
        engine: 'whisper.cpp' as const,
        modelName: whisper.runtime.modelName,
        language: input.language,
        createdAt: completedAt,
        status: 'draft' as const,
        cues
      });
      if (draft === null) throw new Error('whisper.cpp returned subtitle segments outside the project contract.');
      this.update(jobId, { status: 'completed', progressPercent: 100, updatedAt: completedAt, draft });
      this.log(jobId, 'request.completed', { cueCount: cues.length, elapsedSeconds: Math.round((Date.now() - startedAt) / 100) / 10 });
    } catch (error: unknown) {
      if (controller.signal.aborted) {
        this.update(jobId, { status: 'cancelled', updatedAt: new Date().toISOString() });
        return;
      }
      const message = error instanceof Error ? error.message : 'Automatic subtitle transcription failed.';
      this.update(jobId, { status: 'failed', error: message, updatedAt: new Date().toISOString() });
      this.log(jobId, 'request.failed', { elapsedSeconds: Math.round((Date.now() - startedAt) / 100) / 10, error: message }, 'error');
    } finally {
      if (heartbeat !== undefined) clearInterval(heartbeat);
      await source?.file.close().catch(() => undefined);
      this.controllers.delete(jobId);
    }
  }
}
