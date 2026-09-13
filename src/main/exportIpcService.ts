import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';

import { audioProbeArgs, probeSaysAudible } from '../shared/audibleAssets';
import { FILTER_LIST_ARGS, escapeFontPath, fontCandidates, supportsDrawtext } from '../shared/titleFont';
import type { ApiResponse } from '../shared/models';
import { EXPORT_DEFAULTS, type LocalExportJob, type LocalFfmpegRuntimeStatus, type StartExportJobInput } from '../shared/exportTypes';
import { createDeliveryProvenance } from '../shared/exportProvenance';
import {
  DEFAULT_METADATA_PRIVACY_MODE,
  mergeMetadataTagInventories,
  verifyMetadataPrivacy,
  type MetadataPrivacyMode,
  type MetadataPrivacyVerification,
  type MetadataTagInventory
} from '../shared/metadataPrivacy';
import { createSubtitleSidecar, DEFAULT_SUBTITLE_DELIVERY, timelineForSubtitleDelivery, type SubtitleDelivery, type SubtitleSidecar } from '../shared/subtitleDelivery';
import { resolvedTitleStyle } from '../shared/captionStyle';
import { parseExportJobActionInput, parseStartExportJobInput } from '../shared/exportValidators';
import type { LocalProjectSnapshot } from '../shared/timelineTypes';
import type { OpenedAssetPlaybackSource } from './assetLibraryStore';
import { ExportAssetStagingError, removeExportStaging, stageExportAssets, type StagedExportAssets } from './exportAssetStaging';
import { preflightExport, preflightSummary } from '../shared/exportPreflight';
import { reviewExport, type ExportPromise } from '../shared/exportReview';
import { measureExportedFile } from './exportMeasurement';
import { discoverFfmpeg, type FfmpegDiscoveryResult } from './ffmpegDiscovery';
import { startFfmpegExportProcess, type FfmpegExecution, type StartFfmpegExportProcessInput } from './ffmpegExportProcess';
import { compileFfmpegTimeline, FfmpegTimelineError } from './ffmpegTimelineCompiler';
import { ExportJobStore } from './exportJobStore';
import { ExportOutputError, hashExportOutput, prepareExportOutputPath, removeExportOutput, validateExportOutput, writeExportProvenanceSidecar, writeExportSubtitleSidecar } from './exportOutputFiles';
import { inspectContainerMetadata, type InspectContainerMetadataInput } from './containerMetadataInspection';
import { fail, ok } from './ipcResponses';

type ProjectReader = {
  open(projectId: string): Promise<LocalProjectSnapshot | null>;
};

type AssetReader = {
  openPlaybackSource(projectId: string, assetId: string): Promise<OpenedAssetPlaybackSource | null>;
};

type ExportIpcServiceDependencies = {
  readonly projects: ProjectReader;
  readonly assets: AssetReader;
  readonly jobs: ExportJobStore;
  readonly exportsRoot: string;
  readonly discoverFfmpeg?: () => Promise<FfmpegDiscoveryResult>;
  readonly startProcess?: (input: StartFfmpegExportProcessInput) => FfmpegExecution;
  readonly runInBackground?: (task: () => Promise<void>) => void;
  readonly openPath?: (path: string) => Promise<string>;
  readonly revealPath?: (path: string) => void;
  readonly now?: () => Date;
  readonly inspectContainerMetadata?: (input: InspectContainerMetadataInput) => Promise<MetadataTagInventory>;
};

type PreparedExport = {
  readonly executablePath: string;
  readonly outputPath: string;
  readonly args: readonly string[];
  readonly durationMs: number;
  readonly stagingDirectory: string;
  readonly stagedAssetPaths: ReadonlyMap<string, string>;
  /** What this run promises the file will be, to be checked against it after. */
  readonly promise: ExportPromise;
  readonly sidecar?: SubtitleSidecar;
  readonly project: LocalProjectSnapshot;
  readonly subtitleDelivery: SubtitleDelivery;
  readonly metadataPrivacyMode: MetadataPrivacyMode;
};

class MetadataPrivacyVerificationError extends Error {
  override readonly name = 'MetadataPrivacyVerificationError';
}

type PrepareExportInput = {
  readonly jobId: string;
  readonly request: StartExportJobInput;
  readonly project: LocalProjectSnapshot;
  readonly executablePath: string;
};

function exportFailureReason(error: unknown): string {
  if (error instanceof FfmpegTimelineError) {
    return error.message;
  }
  if (error instanceof ExportOutputError) {
    return 'The export output could not be written safely.';
  }
  if (error instanceof ExportAssetStagingError) {
    return error.message;
  }
  if (error instanceof MetadataPrivacyVerificationError) {
    return error.message;
  }
  return 'The local FFmpeg export failed.';
}

export class ExportIpcService {
  private readonly completedOutputs = new Map<string, string>();
  private readonly activeExecutions = new Map<string, FfmpegExecution>();
  private readonly discover: () => Promise<FfmpegDiscoveryResult>;
  private readonly startProcess: (input: StartFfmpegExportProcessInput) => FfmpegExecution;
  private readonly runInBackground: (task: () => Promise<void>) => void;
  private readonly openPath: (path: string) => Promise<string>;
  private readonly revealPath: (path: string) => void;
  private readonly now: () => Date;
  private readonly inspectMetadata: (input: InspectContainerMetadataInput) => Promise<MetadataTagInventory>;

  constructor(private readonly dependencies: ExportIpcServiceDependencies) {
    this.discover = dependencies.discoverFfmpeg ?? discoverFfmpeg;
    this.startProcess = dependencies.startProcess ?? startFfmpegExportProcess;
    this.runInBackground = dependencies.runInBackground ?? ((task) => void task());
    this.openPath = dependencies.openPath ?? (async () => '');
    this.revealPath = dependencies.revealPath ?? (() => undefined);
    this.now = dependencies.now ?? (() => new Date());
    this.inspectMetadata = dependencies.inspectContainerMetadata ?? inspectContainerMetadata;
  }

  async startExportJob(payload: unknown): Promise<ApiResponse<LocalExportJob>> {
    const input = parseStartExportJobInput(payload);
    if (input === null) {
      return fail('INVALID_INPUT', 'The export job payload was not valid.');
    }
    let createdJob: LocalExportJob | null = null;
    try {
      const ffmpeg = await this.discover();
      if (ffmpeg.kind === 'unavailable') {
        return fail('EXPORT_UNAVAILABLE', ffmpeg.reason);
      }
      const project = await this.dependencies.projects.open(input.projectId);
      if (project === null) {
        return fail('PROJECT_NOT_FOUND', 'The project to export was not found.');
      }
      const delivery = input.subtitleDelivery ?? DEFAULT_SUBTITLE_DELIVERY;
      if (delivery.sidecarFormat !== 'none') {
        try {
          createSubtitleSidecar(project.timeline, delivery.sidecarFormat);
        } catch (error) {
          return fail('EXPORT_REFUSED', error instanceof Error ? error.message : 'The subtitle sidecar could not be prepared.');
        }
      }
      /*
        Whether this cut can be rendered at all, before anything is rendered.

        FFmpeg composites layers and holds stills, so the only things this can
        find on the desktop are the cut's own faults — media the project no
        longer has, a clip running past the end of its file — and those used to
        surface as a staging failure or as a frozen tail nobody was told about.
      */
      const problems = preflightExport({
        timeline: project.timeline,
        assets: project.assets,
        capabilities: { stills: true, layeredVideo: true }
      });
      if (problems.length > 0) {
        return fail('EXPORT_REFUSED', preflightSummary(problems));
      }
      const job = this.dependencies.jobs.create(project.id);
      createdJob = job;
      const prepared = await this.prepareExport({
        jobId: job.id,
        request: input,
        project,
        executablePath: ffmpeg.executablePath
      });
      this.runInBackground(() => this.runExport(job.id, prepared));
      return ok(job);
    } catch (error: unknown) {
      const reason = error instanceof Error ? exportFailureReason(error) : 'The local FFmpeg export failed.';
      if (createdJob !== null && this.dependencies.jobs.get(createdJob.id)?.state.kind === 'queued') {
        this.dependencies.jobs.markFailed(createdJob.id, reason);
      }
      return fail('EXPORT_UNAVAILABLE', reason);
    }
  }

  async getFfmpegRuntimeStatus(): Promise<ApiResponse<LocalFfmpegRuntimeStatus>> {
    const ffmpeg = await this.discover();
    return ok(ffmpeg.kind === 'unavailable' ? { kind: 'unavailable', reason: ffmpeg.reason } : { kind: ffmpeg.kind });
  }

  async getExportJob(payload: unknown): Promise<ApiResponse<LocalExportJob>> {
    const input = parseExportJobActionInput(payload);
    if (input === null) {
      return fail('INVALID_INPUT', 'The export job lookup payload was not valid.');
    }
    const job = this.dependencies.jobs.get(input.jobId);
    return job === null ? fail('JOB_NOT_FOUND', 'The export job was not found.') : ok(job);
  }

  async cancelExportJob(payload: unknown): Promise<ApiResponse<{ readonly cancelled: boolean }>> {
    const input = parseExportJobActionInput(payload);
    if (input === null) {
      return fail('INVALID_INPUT', 'The export cancellation payload was not valid.');
    }
    if (this.dependencies.jobs.get(input.jobId) === null) {
      return fail('JOB_NOT_FOUND', 'The export job was not found.');
    }
    const cancelled = this.dependencies.jobs.cancel(input.jobId);
    if (cancelled) {
      this.activeExecutions.get(input.jobId)?.cancel();
    }
    return ok({ cancelled });
  }

  async openExportResult(payload: unknown): Promise<ApiResponse<{ readonly opened: boolean }>> {
    const output = await this.completedOutput(payload);
    if (!output.ok) {
      return output;
    }
    const openError = await this.openPath(output.value);
    return openError.length > 0 ? fail('UNKNOWN_ERROR', 'The exported video could not be opened.') : ok({ opened: true });
  }

  async revealExportResult(payload: unknown): Promise<ApiResponse<{ readonly revealed: boolean }>> {
    const output = await this.completedOutput(payload);
    if (!output.ok) {
      return output;
    }
    this.revealPath(output.value);
    return ok({ revealed: true });
  }

  cancelAll(): void {
    for (const jobId of this.activeExecutions.keys()) {
      this.dependencies.jobs.cancel(jobId);
      this.activeExecutions.get(jobId)?.cancel();
    }
  }

  /**
   * Asks FFmpeg which of these files actually have sound.
   *
   * One invocation per asset that maps the first audio stream and decodes none
   * of it, so the cost is a process start rather than a decode. Anything that
   * does not exit cleanly is taken as silent — losing the audio of a file
   * nothing could read costs a track that was already unreachable, while
   * guessing the other way costs the export.
   */
  private async audibleAssets(
    executablePath: string,
    assetPaths: ReadonlyMap<string, string>
  ): Promise<ReadonlySet<string>> {
    const audible = new Set<string>();
    await Promise.all(
      [...assetPaths].map(
        async ([assetId, assetPath]) =>
          new Promise<void>((resolve) => {
            const probe = spawn(executablePath, [...audioProbeArgs(assetPath)], { stdio: 'ignore' });
            probe.on('error', () => resolve());
            probe.on('close', (code) => {
              if (probeSaysAudible(code)) audible.add(assetId);
              resolve();
            });
          })
      )
    );
    return audible;
  }

  /**
   * A font `drawtext` can use, or a refusal that names what is missing.
   *
   * Two things have to hold and neither is guaranteed by an FFmpeg the user
   * supplied: the build has to carry libfreetype, and the machine has to have a
   * font where one is expected. Saying which of the two failed is the difference
   * between a fixable message and a mysterious export.
   */
  private async titleFont(executablePath: string, weight: 'regular' | 'bold' = 'regular'): Promise<string> {
    const filters = await new Promise<string>((resolve) => {
      let listing = '';
      const probe = spawn(executablePath, [...FILTER_LIST_ARGS]);
      probe.stdout?.on('data', (chunk: Buffer) => {
        listing += chunk.toString();
      });
      probe.on('error', () => resolve(''));
      probe.on('close', () => resolve(listing));
    });
    if (!supportsDrawtext(filters)) {
      throw new ExportAssetStagingError(
        'This FFmpeg build cannot draw text — it was compiled without libfreetype, so titles cannot be rendered.'
      );
    }
    for (const candidate of fontCandidates(process.platform, weight)) {
      try {
        await access(candidate);
        return escapeFontPath(candidate);
      } catch {
        // Try the next one; a machine without this face is ordinary.
      }
    }
    throw new ExportAssetStagingError(`No ${weight} system font could be found on this machine to draw titles with.`);
  }

  private async prepareExport(input: PrepareExportInput): Promise<PreparedExport> {
    const outputPath = await prepareExportOutputPath(this.dependencies.exportsRoot, input.jobId);
    const dimensions = this.outputDimensions(input.request, input.project);
    const frameRate = input.request.frameRate ?? EXPORT_DEFAULTS.frameRate;
    let staged: StagedExportAssets | null = null;
    try {
      const delivery = input.request.subtitleDelivery ?? DEFAULT_SUBTITLE_DELIVERY;
      const metadataPrivacyMode = input.request.metadataPrivacyMode ?? DEFAULT_METADATA_PRIVACY_MODE;
      const exportTimeline = timelineForSubtitleDelivery(input.project.timeline, delivery);
      const sidecar = delivery.sidecarFormat === 'none'
        ? undefined
        : createSubtitleSidecar(input.project.timeline, delivery.sidecarFormat, dimensions);
      staged = await stageExportAssets({
        assets: this.dependencies.assets,
        project: input.project,
        exportsRoot: this.dependencies.exportsRoot,
        jobId: input.jobId
      });
      const compiled = compileFfmpegTimeline({
        timeline: exportTimeline,
        assetPaths: staged.assetPaths,
        // The compiler works from the timeline, which does not record what an
        // asset is; the project does. Without this a still is opened as a movie
        // and contributes one frame instead of its clip's length.
        stillAssetIds: new Set(
          input.project.assets.filter((asset) => asset.kind === 'image').map((asset) => asset.id)
        ),
        // Which assets have sound of their own. A video clip's audio used to be
        // dropped entirely, so a cut came out silent unless somebody had
        // separately placed an audio clip.
        //
        // Probed rather than assumed from the kind: a silent recording is an
        // ordinary thing to have on a timeline, and `[i:a:0]` on a source with
        // no audio stream fails the whole graph.
        audibleAssetIds: await this.audibleAssets(input.executablePath, staged.assetPaths),
        // Only looked for when there is something to draw: an export with no
        // titles must not fail because the machine has an unusual font layout.
        ...((exportTimeline.titles ?? []).length > 0
          ? {
              titleFontPath: await this.titleFont(input.executablePath),
              ...((exportTimeline.titles ?? []).some((title) => resolvedTitleStyle(title).fontWeight === 'bold')
                ? { titleBoldFontPath: await this.titleFont(input.executablePath, 'bold') }
                : {})
            }
          : {}),
        outputPath,
        ...dimensions,
        frameRate,
        metadataPrivacyMode
      });
      return {
        executablePath: input.executablePath,
        outputPath,
        stagingDirectory: staged.directory,
        stagedAssetPaths: staged.assetPaths,
        args: compiled.args,
        durationMs: compiled.durationMs,
        project: input.project,
        subtitleDelivery: delivery,
        metadataPrivacyMode,
        promise: {
          widthPx: dimensions.width,
          heightPx: dimensions.height,
          frameRate,
          durationMs: compiled.durationMs,
          // What the graph actually carries, not what the timeline looks like
          // it should: a video clip whose source turned out to be silent maps
          // no audio, and a file with no sound is right in that case.
          hasSound: compiled.hasSound
        },
        ...(sidecar === undefined ? {} : { sidecar })
      };
    } catch (error: unknown) {
      await Promise.all([
        removeExportOutput(outputPath),
        ...(staged === null ? [] : [removeExportStaging(staged.directory)])
      ]);
      throw error;
    }
  }

  private outputDimensions(input: StartExportJobInput, project: LocalProjectSnapshot): { readonly width: number; readonly height: number } {
    if (input.width !== undefined && input.height !== undefined) {
      return { width: input.width, height: input.height };
    }
    const videoMetadata = project.assets.find((asset) => asset.kind === 'video' && asset.metadata?.width !== undefined && asset.metadata.height !== undefined)?.metadata;
    return {
      width: this.normalizedDimension(videoMetadata?.width, EXPORT_DEFAULTS.width, 7_680),
      height: this.normalizedDimension(videoMetadata?.height, EXPORT_DEFAULTS.height, 4_320)
    };
  }

  private normalizedDimension(value: number | undefined, fallback: number, maximum: number): number {
    if (value === undefined || !Number.isInteger(value) || value < 16) return fallback;
    const bounded = Math.min(value, maximum);
    return bounded - bounded % 2;
  }

  private async verifyDeliveryMetadata(prepared: PreparedExport): Promise<MetadataPrivacyVerification> {
    try {
      const [sourceInventories, outputInventory] = await Promise.all([
        Promise.all([...prepared.stagedAssetPaths.values()].map((filePath) => this.inspectMetadata({
          ffmpegPath: prepared.executablePath,
          filePath
        }))),
        this.inspectMetadata({ ffmpegPath: prepared.executablePath, filePath: prepared.outputPath })
      ]);
      return verifyMetadataPrivacy(
        prepared.metadataPrivacyMode,
        mergeMetadataTagInventories(sourceInventories),
        outputInventory
      );
    } catch {
      const unchecked = { checked: false, fields: [] } as const;
      return verifyMetadataPrivacy(prepared.metadataPrivacyMode, unchecked, unchecked);
    }
  }

  private assertPrivacyCleanVerified(verification: MetadataPrivacyVerification): void {
    if (verification.mode !== 'privacy_clean') return;
    if (!verification.checked) {
      throw new MetadataPrivacyVerificationError(
        'Privacy Clean could not verify container metadata with FFprobe, so no delivery was kept.'
      );
    }
    if (!verification.ok) {
      const remaining = verification.afterFields.map((field) => field.label).join(', ');
      throw new MetadataPrivacyVerificationError(
        `Privacy Clean found personal container metadata remaining in the output: ${remaining}. No delivery was kept.`
      );
    }
  }

  private async runExport(jobId: string, prepared: PreparedExport): Promise<void> {
    if (this.dependencies.jobs.get(jobId)?.state.kind !== 'queued') {
      await Promise.all([removeExportOutput(prepared.outputPath), removeExportStaging(prepared.stagingDirectory)]);
      return;
    }
    this.dependencies.jobs.markRunning(jobId, prepared.durationMs);
    let subtitleOutputPath: string | undefined;
    let provenanceOutputPath: string | undefined;
    try {
      const execution = this.startProcess({
        executablePath: prepared.executablePath,
        args: prepared.args,
        durationMs: prepared.durationMs,
        onProgress: (progress) => {
          if (this.dependencies.jobs.get(jobId)?.state.kind === 'running') {
            this.dependencies.jobs.updateProgress(jobId, progress);
          }
        }
      });
      this.activeExecutions.set(jobId, execution);
      await execution.completion;
      if (this.dependencies.jobs.get(jobId)?.state.kind !== 'running') {
        return;
      }
      const output = await validateExportOutput(this.dependencies.exportsRoot, prepared.outputPath);
      const [measurement, metadataPrivacyVerification] = await Promise.all([
        measureExportedFile({ ffmpegPath: prepared.executablePath, filePath: prepared.outputPath }),
        this.verifyDeliveryMetadata(prepared)
      ]);
      this.assertPrivacyCleanVerified(metadataPrivacyVerification);
      const subtitleOutput = prepared.sidecar === undefined
        ? undefined
        : await writeExportSubtitleSidecar(this.dependencies.exportsRoot, jobId, prepared.sidecar);
      subtitleOutputPath = subtitleOutput?.outputPath;
      /*
        Read the file back before calling it done.

        A zero exit and a file on disk is what every truncated, silent or
        dropped-layer export this project has shipped also produced. The file
        is measured and compared with what this run promised; a machine that
        cannot measure says so rather than passing it.
      */
      const review = reviewExport(
        prepared.promise,
        measurement
      );
      const checksum = await hashExportOutput(prepared.outputPath);
      if (checksum.fileSizeBytes !== output.fileSizeBytes) {
        throw new ExportOutputError('The MP4 changed before its provenance sidecar was created.');
      }
      const provenanceOutput = await writeExportProvenanceSidecar(
        this.dependencies.exportsRoot,
        jobId,
        createDeliveryProvenance({
          project: prepared.project,
          exportedAt: this.now().toISOString(),
          width: prepared.promise.widthPx,
          height: prepared.promise.heightPx,
          frameRate: prepared.promise.frameRate,
          durationMs: prepared.promise.durationMs,
          subtitleDelivery: prepared.subtitleDelivery,
          metadataPrivacyMode: prepared.metadataPrivacyMode,
          metadataPrivacyVerification,
          output: { fileName: output.fileName, fileSizeBytes: output.fileSizeBytes, sha256: checksum.sha256 }
        })
      );
      provenanceOutputPath = provenanceOutput.outputPath;
      this.dependencies.jobs.markCompleted(
        jobId,
        output.fileName,
        output.fileSizeBytes,
        review,
        subtitleOutput?.fileName,
        provenanceOutput.fileName,
        metadataPrivacyVerification
      );
      this.completedOutputs.set(jobId, prepared.outputPath);
    } catch (error: unknown) {
      if (this.dependencies.jobs.get(jobId)?.state.kind === 'running') {
        const reason = error instanceof Error ? exportFailureReason(error) : 'The local FFmpeg export failed.';
        this.dependencies.jobs.markFailed(jobId, reason);
      }
    } finally {
      this.activeExecutions.delete(jobId);
      const removePartialOutput = this.dependencies.jobs.get(jobId)?.state.kind === 'completed'
        ? Promise.resolve()
        : removeExportOutput(prepared.outputPath);
      const removePartialSubtitle = this.dependencies.jobs.get(jobId)?.state.kind === 'completed' || subtitleOutputPath === undefined
        ? Promise.resolve()
        : removeExportOutput(subtitleOutputPath);
      const removePartialProvenance = this.dependencies.jobs.get(jobId)?.state.kind === 'completed' || provenanceOutputPath === undefined
        ? Promise.resolve()
        : removeExportOutput(provenanceOutputPath);
      await Promise.all([removeExportStaging(prepared.stagingDirectory), removePartialOutput, removePartialSubtitle, removePartialProvenance]);
    }
  }

  private async completedOutput(payload: unknown): Promise<ApiResponse<string>> {
    const input = parseExportJobActionInput(payload);
    if (input === null) {
      return fail('INVALID_INPUT', 'The export result action payload was not valid.');
    }
    const job = this.dependencies.jobs.get(input.jobId);
    const outputPath = this.completedOutputs.get(input.jobId);
    if (job?.state.kind !== 'completed' || outputPath === undefined) {
      return fail('EXPORT_RESULT_UNAVAILABLE', 'The exported video result is not available.');
    }
    try {
      await validateExportOutput(this.dependencies.exportsRoot, outputPath);
      return ok(outputPath);
    } catch (error: unknown) {
      if (!(error instanceof Error)) {
        throw error;
      }
      return fail('EXPORT_RESULT_UNAVAILABLE', 'The exported video result is not available.');
    }
  }
}
