import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, extname, join } from 'node:path';
import { pipeline } from 'node:stream/promises';

import type { ApiResponse } from '../shared/models';
import type { DetachVideoAudioResult, MediaAsset } from '../shared/timelineTypes';
import { parseDetachVideoAudioInput } from '../shared/timelineValidators';
import type { AssetLibraryStore } from './assetLibraryStore';
import { discoverFfmpeg, type FfmpegDiscoveryResult } from './ffmpegDiscovery';
import {
  FfmpegExportProcessError,
  startFfmpegExportProcess,
  type FfmpegExecution
} from './ffmpegExportProcess';
import { fail, ok } from './ipcResponses';
import type { ProjectStore } from './projectStore';

const EXTRACTION_TIMEOUT_MS = 5 * 60 * 1_000;

type RunAudioExtractionInput = {
  readonly executablePath: string;
  readonly sourcePath: string;
  readonly outputPath: string;
  readonly durationMs: number;
  readonly onProgress?: (processedMs: number) => void;
};

type AudioDetachServiceDependencies = {
  readonly projects: ProjectStore;
  readonly assets: AssetLibraryStore;
  readonly discoverFfmpeg?: () => Promise<FfmpegDiscoveryResult>;
  readonly runExtraction?: (input: RunAudioExtractionInput) => Promise<void>;
  readonly temporaryRoot?: string;
};

function hasNoAudioStream(diagnostics: string): boolean {
  const normalized = diagnostics.toLowerCase();
  return normalized.includes('matches no streams') ||
    normalized.includes('does not contain any stream') ||
    normalized.includes('stream specifier') && normalized.includes('no stream');
}

async function awaitWithTimeout(execution: FfmpegExecution, timeoutMs: number): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      execution.completion,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          execution.cancel();
          reject(new Error('Audio extraction timed out.'));
        }, timeoutMs);
      })
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

async function runFfmpegExtraction(input: RunAudioExtractionInput): Promise<void> {
  const execution = startFfmpegExportProcess({
    executablePath: input.executablePath,
    durationMs: input.durationMs,
    onProgress: (progress) => input.onProgress?.(progress.processedMs),
    args: [
      '-nostdin',
      '-hide_banner',
      '-loglevel', 'error',
      '-y',
      '-i', input.sourcePath,
      '-map', '0:a:0',
      '-vn',
      // Preserve A/V sync even when the stream starts late or ends early:
      // leading/trailing silence keeps source milliseconds meaningful.
      '-af', 'aresample=async=1:first_pts=0,apad',
      '-t', (input.durationMs / 1_000).toFixed(3),
      '-c:a', 'pcm_s16le',
      '-ar', '48000',
      '-ac', '2',
      '-progress', 'pipe:1',
      '-nostats',
      input.outputPath
    ]
  });
  await awaitWithTimeout(execution, EXTRACTION_TIMEOUT_MS);
}

function detachedDisplayName(asset: MediaAsset): string {
  const extension = extname(asset.displayName);
  const stem = extension.length === 0 ? asset.displayName : asset.displayName.slice(0, -extension.length);
  return `${stem.trim() || 'Video'} - detached audio.wav`;
}

export class AudioDetachService {
  private readonly discover: () => Promise<FfmpegDiscoveryResult>;
  private readonly runExtraction: (input: RunAudioExtractionInput) => Promise<void>;

  constructor(private readonly dependencies: AudioDetachServiceDependencies) {
    this.discover = dependencies.discoverFfmpeg ?? discoverFfmpeg;
    this.runExtraction = dependencies.runExtraction ?? runFfmpegExtraction;
  }

  async detach(payload: unknown): Promise<ApiResponse<DetachVideoAudioResult>> {
    const input = parseDetachVideoAudioInput(payload);
    if (input === null) return fail('INVALID_INPUT', 'The detach-audio request was not valid.');

    const requestId = randomUUID().slice(0, 8);
    const log = (event: string, details: Readonly<Record<string, unknown>> = {}): void => {
      console.info(`[OpenScene][Detach Audio][${requestId}] ${event} ${JSON.stringify(details)}`);
    };
    const startedAt = Date.now();
    log('request.start', { projectId: input.projectId, assetId: input.assetId });

    let temporaryDirectory: string | null = null;
    let source: Awaited<ReturnType<AssetLibraryStore['openPlaybackSource']>> = null;
    try {
      const asset = await this.dependencies.projects.getAsset(input.projectId, input.assetId);
      if (asset === null) return fail('ASSET_NOT_FOUND', 'The selected video asset is not available.');
      if (asset.kind !== 'video') return fail('INVALID_INPUT', 'Only a video asset can have embedded audio detached.');
      if (asset.metadata === null || asset.metadata.durationMs <= 0) {
        return fail('INVALID_INPUT', 'Analyze the video metadata before detaching its audio.');
      }

      source = await this.dependencies.assets.openPlaybackSource(input.projectId, input.assetId);
      if (source === null) return fail('ASSET_NOT_FOUND', 'The selected video file is no longer available.');

      const runtime = await this.discover();
      if (runtime.kind === 'unavailable') {
        return fail('AUDIO_EXTRACTION_UNAVAILABLE', `${runtime.reason} Configure VIDEO_TOOL_FFMPEG_PATH and restart OpenScene.`);
      }
      log('ffmpeg.ready', { runtime: runtime.kind });

      temporaryDirectory = await mkdtemp(join(this.dependencies.temporaryRoot ?? tmpdir(), 'openscene-detach-audio-'));
      const stagedSourcePath = join(temporaryDirectory, `source${extname(asset.projectRelativePath) || '.media'}`);
      const outputPath = join(temporaryDirectory, 'detached.wav');
      // FFmpeg receives a private copy read through the already-validated file
      // handle. It never reopens a user-controlled project path after the
      // symlink/identity checks in AssetLibraryStore.
      await pipeline(
        source.file.createReadStream({ autoClose: false }),
        createWriteStream(stagedSourcePath, { flags: 'wx', mode: 0o600 })
      );
      await source.file.close();
      source = null;
      log('source.staged', { sourceBytes: asset.byteLength });
      log('process.started', { sourceBytes: asset.byteLength, durationMs: asset.metadata.durationMs });
      let lastProgressBucket = -1;
      await this.runExtraction({
        executablePath: runtime.executablePath,
        sourcePath: stagedSourcePath,
        outputPath,
        durationMs: asset.metadata.durationMs,
        onProgress: (processedMs) => {
          const percent = Math.min(100, Math.max(0, Math.round(processedMs / asset.metadata!.durationMs * 100)));
          const bucket = Math.floor(percent / 10);
          if (bucket === lastProgressBucket) return;
          lastProgressBucket = bucket;
          log('process.progress', { percent, processedMs });
        }
      });
      log('process.completed', { elapsedSeconds: Math.round((Date.now() - startedAt) / 1000) });

      const imported = await this.dependencies.assets.import({
        projectId: input.projectId,
        sourcePath: outputPath,
        displayName: detachedDisplayName(asset),
        kind: 'audio',
        mimeType: 'audio/wav'
      });
      const readyAsset = await this.dependencies.assets.updateMetadata({
        projectId: input.projectId,
        assetId: imported.id,
        durationMs: asset.metadata.durationMs
      });
      log('asset.imported', { assetId: readyAsset.id, bytes: readyAsset.byteLength });
      return ok({ asset: readyAsset });
    } catch (error: unknown) {
      if (error instanceof FfmpegExportProcessError && hasNoAudioStream(error.diagnostics)) {
        log('request.failed', { code: 'AUDIO_NOT_FOUND' });
        return fail('AUDIO_NOT_FOUND', 'This video does not contain an audio stream to detach.');
      }
      const message = error instanceof Error && error.message === 'Audio extraction timed out.'
        ? error.message
        : 'The video audio could not be extracted or imported.';
      log('request.failed', {
        code: 'FILE_WRITE_FAILED',
        errorName: error instanceof Error ? error.name : 'UnknownError',
        systemCode: error instanceof Error && 'code' in error ? String(error.code) : undefined
      });
      return fail('FILE_WRITE_FAILED', message);
    } finally {
      if (source !== null) await source.file.close().catch(() => undefined);
      if (temporaryDirectory !== null) {
        await rm(temporaryDirectory, { recursive: true, force: true, maxRetries: 4, retryDelay: 100 })
          .then(() => log('cleanup.complete'))
          .catch((error: unknown) => log('cleanup.deferred', {
            directory: basename(temporaryDirectory ?? ''),
            errorName: error instanceof Error ? error.name : 'UnknownError',
            systemCode: error instanceof Error && 'code' in error ? String(error.code) : undefined
          }));
      }
    }
  }
}
