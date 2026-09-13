import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, extname, join } from 'node:path';
import { pipeline } from 'node:stream/promises';

import type { ApiResponse } from '../shared/models';
import type { MediaAsset } from '../shared/timelineTypes';
import { parseProjectAssetReferenceInput, type ExtractContinuationFrameResult } from '../shared/continuityFrame';
import type { ReferenceImageSelection } from '../shared/providerSeams';
import type { AssetLibraryStore, OpenedAssetPlaybackSource } from './assetLibraryStore';
import { discoverFfmpeg, type FfmpegDiscoveryResult } from './ffmpegDiscovery';
import { startFfmpegExportProcess, type FfmpegExecution } from './ffmpegExportProcess';
import { fail, ok } from './ipcResponses';
import type { ProjectStore } from './projectStore';
import { REFERENCE_IMAGE_MAX_BYTES } from './referenceImagePicker';

const FRAME_EXTRACTION_TIMEOUT_MS = 60_000;
const FRAME_PROCESS_SETTLE_TIMEOUT_MS = 2_500;
const FRAME_MIME_TYPE = 'image/jpeg';

type RunBoundaryFrameInput = {
  readonly executablePath: string;
  readonly sourcePath: string;
  readonly outputPath: string;
  readonly sourceTimeMs: number;
};

type ContinuityFrameServiceDependencies = {
  readonly projects: ProjectStore;
  readonly assets: AssetLibraryStore;
  readonly discoverFfmpeg?: () => Promise<FfmpegDiscoveryResult>;
  readonly runExtraction?: (input: RunBoundaryFrameInput) => Promise<void>;
  readonly temporaryRoot?: string;
};

async function waitForExtraction(execution: FfmpegExecution): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  let timedOut = false;
  try {
    await Promise.race([
      execution.completion,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          timedOut = true;
          reject(new Error('Continuity-frame extraction timed out.'));
        }, FRAME_EXTRACTION_TIMEOUT_MS);
      })
    ]);
  } catch (error) {
    if (timedOut) {
      execution.cancel();
      // Windows can keep the staged files locked until FFmpeg has actually
      // exited. Give cancellation time to settle before cleanup starts.
      await Promise.race([
        execution.completion.then(() => undefined, () => undefined),
        new Promise<void>((resolve) => setTimeout(resolve, FRAME_PROCESS_SETTLE_TIMEOUT_MS))
      ]);
    }
    throw error;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

async function runFfmpegBoundaryFrame(input: RunBoundaryFrameInput): Promise<void> {
  const execution = startFfmpegExportProcess({
    executablePath: input.executablePath,
    durationMs: Math.max(1, input.sourceTimeMs),
    onProgress: () => undefined,
    args: [
      '-nostdin',
      '-hide_banner',
      '-loglevel', 'error',
      '-y',
      '-ss', (input.sourceTimeMs / 1_000).toFixed(3),
      '-i', input.sourcePath,
      '-map', '0:v:0',
      '-frames:v', '1',
      '-vf', "scale=w='min(1920,iw)':h='min(1920,ih)':force_original_aspect_ratio=decrease",
      '-q:v', '2',
      '-map_metadata', '-1',
      '-progress', 'pipe:1',
      '-nostats',
      input.outputPath
    ]
  });
  await waitForExtraction(execution);
}

function continuationFrameName(asset: MediaAsset): string {
  const extension = extname(asset.displayName);
  const stem = extension.length === 0 ? asset.displayName : asset.displayName.slice(0, -extension.length);
  return `${stem.trim() || 'Video'} - continuity frame.jpg`;
}

function isJpeg(bytes: Buffer): boolean {
  return bytes.byteLength >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

function isPng(bytes: Buffer): boolean {
  return bytes.byteLength >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
}

function isWebp(bytes: Buffer): boolean {
  return bytes.byteLength >= 12 && bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP';
}

function matchesImageMime(bytes: Buffer, mimeType: string): boolean {
  return mimeType === 'image/jpeg' ? isJpeg(bytes)
    : mimeType === 'image/png' ? isPng(bytes)
      : mimeType === 'image/webp' ? isWebp(bytes)
        : false;
}

function boundaryFrameTimes(durationMs: number): readonly number[] {
  return [...new Set([100, 500, 1_500].map((endGuardMs) => Math.max(0, durationMs - endGuardMs)))];
}

function referenceFromBytes(asset: MediaAsset, bytes: Buffer): ApiResponse<ReferenceImageSelection> {
  if (asset.kind !== 'image' || !matchesImageMime(bytes, asset.mimeType)) {
    return fail('INVALID_INPUT', 'The saved project reference is not a supported PNG, JPEG, or WebP image.');
  }
  if (bytes.byteLength > REFERENCE_IMAGE_MAX_BYTES) {
    return fail('INVALID_INPUT', `The saved project image is larger than ${REFERENCE_IMAGE_MAX_BYTES / (1024 * 1024)}MB.`);
  }
  return ok({ displayName: asset.displayName, mimeType: asset.mimeType, base64: bytes.toString('base64') });
}

export class ContinuityFrameService {
  private readonly discover: () => Promise<FfmpegDiscoveryResult>;
  private readonly runExtraction: (input: RunBoundaryFrameInput) => Promise<void>;

  constructor(private readonly dependencies: ContinuityFrameServiceDependencies) {
    this.discover = dependencies.discoverFfmpeg ?? discoverFfmpeg;
    this.runExtraction = dependencies.runExtraction ?? runFfmpegBoundaryFrame;
  }

  async extract(payload: unknown): Promise<ApiResponse<ExtractContinuationFrameResult>> {
    const input = parseProjectAssetReferenceInput(payload);
    if (input === null) return fail('INVALID_INPUT', 'The continuity-frame request was not valid.');

    const requestId = randomUUID().slice(0, 8);
    const startedAt = Date.now();
    const log = (event: string, details: Readonly<Record<string, unknown>> = {}): void => {
      console.info(`[OpenScene][Continuity Frame][${requestId}] ${event} ${JSON.stringify(details)}`);
    };
    let source: OpenedAssetPlaybackSource | null = null;
    let temporaryDirectory: string | null = null;
    try {
      const asset = await this.dependencies.projects.getAsset(input.projectId, input.assetId);
      if (asset === null) return fail('ASSET_NOT_FOUND', 'The approved candidate video is no longer available.');
      if (asset.kind !== 'video') return fail('INVALID_INPUT', 'A continuity frame can only be extracted from a video.');
      if (asset.metadata === null || asset.metadata.durationMs <= 0) {
        return fail('INVALID_INPUT', 'Analyze the candidate video metadata before extracting its continuity frame.');
      }
      log('request.start', { projectId: input.projectId, assetId: input.assetId, durationMs: asset.metadata.durationMs });

      source = await this.dependencies.assets.openPlaybackSource(input.projectId, input.assetId);
      if (source === null) return fail('ASSET_NOT_FOUND', 'The approved candidate file is no longer available.');
      const runtime = await this.discover();
      if (runtime.kind === 'unavailable') {
        return fail('EXPORT_UNAVAILABLE', `${runtime.reason} Configure VIDEO_TOOL_FFMPEG_PATH and restart OpenScene.`);
      }

      temporaryDirectory = await mkdtemp(join(this.dependencies.temporaryRoot ?? tmpdir(), 'openscene-continuity-frame-'));
      const stagedSourcePath = join(temporaryDirectory, `source${extname(asset.projectRelativePath) || '.media'}`);
      const outputPath = join(temporaryDirectory, 'continuity-frame.jpg');
      await pipeline(source.file.createReadStream({ autoClose: false }), createWriteStream(stagedSourcePath, { flags: 'wx', mode: 0o600 }));
      await source.file.close();
      source = null;

      // Containers sometimes round their declared duration upward. Try the
      // closest frame first, then move slightly earlier only when decoding did
      // not yield a valid still.
      let sourceTimeMs = 0;
      let bytes: Buffer | null = null;
      let lastExtractionError: unknown = null;
      const attempts = boundaryFrameTimes(asset.metadata.durationMs);
      for (const [attemptIndex, candidateTimeMs] of attempts.entries()) {
        await rm(outputPath, { force: true });
        log('process.started', {
          sourceBytes: asset.byteLength,
          sourceTimeMs: candidateTimeMs,
          attempt: attemptIndex + 1,
          attempts: attempts.length,
          runtime: runtime.kind
        });
        try {
          await this.runExtraction({ executablePath: runtime.executablePath, sourcePath: stagedSourcePath, outputPath, sourceTimeMs: candidateTimeMs });
          const candidateBytes = await readFile(outputPath);
          if (isJpeg(candidateBytes) && candidateBytes.byteLength <= REFERENCE_IMAGE_MAX_BYTES) {
            sourceTimeMs = candidateTimeMs;
            bytes = candidateBytes;
            break;
          }
          lastExtractionError = new Error('FFmpeg produced an invalid or oversized JPEG.');
        } catch (error) {
          if (error instanceof Error && error.message === 'Continuity-frame extraction timed out.') throw error;
          lastExtractionError = error;
        }
        log('process.retrying', { attempt: attemptIndex + 1 });
      }
      if (bytes === null) {
        throw lastExtractionError ?? new Error('FFmpeg did not produce a usable continuity frame.');
      }

      const imported = await this.dependencies.assets.import({
        projectId: input.projectId,
        sourcePath: outputPath,
        displayName: continuationFrameName(asset),
        kind: 'image',
        mimeType: FRAME_MIME_TYPE
      });
      const readyAsset = await this.dependencies.assets.updateMetadata({
        projectId: input.projectId,
        assetId: imported.id,
        durationMs: 0
      });
      log('request.completed', { assetId: readyAsset.id, bytes: bytes.byteLength, elapsedMs: Date.now() - startedAt });
      return ok({
        asset: readyAsset,
        reference: { displayName: readyAsset.displayName, mimeType: FRAME_MIME_TYPE, base64: bytes.toString('base64') },
        sourceTimeMs
      });
    } catch (error: unknown) {
      log('request.failed', {
        errorName: error instanceof Error ? error.name : 'UnknownError',
        systemCode: error instanceof Error && 'code' in error ? String(error.code) : undefined,
        elapsedMs: Date.now() - startedAt
      });
      return fail('FILE_WRITE_FAILED', error instanceof Error && error.message === 'Continuity-frame extraction timed out.'
        ? error.message
        : 'The approved candidate frame could not be extracted or imported.');
    } finally {
      if (source !== null) await source.file.close().catch(() => undefined);
      if (temporaryDirectory !== null) {
        await rm(temporaryDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 })
          .then(() => log('cleanup.complete'))
          .catch((error: unknown) => log('cleanup.deferred', {
            directory: basename(temporaryDirectory ?? ''),
            errorName: error instanceof Error ? error.name : 'UnknownError',
            systemCode: error instanceof Error && 'code' in error ? String(error.code) : undefined
          }));
      }
    }
  }

  async getReference(payload: unknown): Promise<ApiResponse<ReferenceImageSelection>> {
    const input = parseProjectAssetReferenceInput(payload);
    if (input === null) return fail('INVALID_INPUT', 'The project-image request was not valid.');
    const asset = await this.dependencies.projects.getAsset(input.projectId, input.assetId);
    if (asset === null) return fail('ASSET_NOT_FOUND', 'The saved project image is no longer available.');
    let source: OpenedAssetPlaybackSource | null = null;
    try {
      source = await this.dependencies.assets.openPlaybackSource(input.projectId, input.assetId);
      if (source === null) return fail('ASSET_NOT_FOUND', 'The saved project image file is no longer available.');
      if (source.byteLength > REFERENCE_IMAGE_MAX_BYTES) {
        return fail('INVALID_INPUT', `The saved project image is larger than ${REFERENCE_IMAGE_MAX_BYTES / (1024 * 1024)}MB.`);
      }
      return referenceFromBytes(asset, await source.file.readFile());
    } catch {
      return fail('ASSET_NOT_FOUND', 'The saved project image could not be read.');
    } finally {
      await source?.file.close().catch(() => undefined);
    }
  }
}
