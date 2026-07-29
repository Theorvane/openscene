import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Frame planning and extraction for the Edit Agent's watchProjectVideo tool,
 * converted from the claude-video /watch skill: duration-budgeted uniform
 * sampling (denser on focused ranges, hard 2 fps rate cap), width-512 JPEG
 * frames extracted with the discovered FFmpeg runtime.
 */

export const WATCH_FRAME_WIDTH_PX = 512;
export const WATCH_FRAME_HARD_CAP = 20;
export const WATCH_FRAME_DEFAULT_MAX = 12;
const MAX_FRAME_RATE_PER_SECOND = 2;
const FFMPEG_FRAME_TIMEOUT_MS = 30_000;

export type FramePlanInput = {
  readonly durationMs: number;
  readonly startMs?: number | undefined;
  readonly endMs?: number | undefined;
  readonly maxFrames?: number | undefined;
};

/** claude-video's full-video frame budget ladder, scaled to tool-message size. */
function budgetForRange(rangeMs: number, focused: boolean): number {
  if (focused) {
    // Focused ranges sample denser, still capped at 2 fps by the caller.
    if (rangeMs <= 15_000) return 10;
    if (rangeMs <= 60_000) return 14;
    return 16;
  }
  if (rangeMs <= 30_000) return 8;
  if (rangeMs <= 60_000) return 10;
  if (rangeMs <= 180_000) return 12;
  return 14;
}

/**
 * Plan uniform, centered frame timestamps across the requested range. Returns
 * [] for unusable input (no duration, empty range).
 */
export function planFrameTimestamps(input: FramePlanInput): readonly number[] {
  if (!Number.isFinite(input.durationMs) || input.durationMs <= 0) return [];
  const startMs = Math.max(0, Math.min(input.startMs ?? 0, input.durationMs));
  const endMs = Math.max(startMs, Math.min(input.endMs ?? input.durationMs, input.durationMs));
  const rangeMs = endMs - startMs;
  if (rangeMs <= 0) return [];

  const focused = input.startMs !== undefined || input.endMs !== undefined;
  const requestedCap = input.maxFrames !== undefined && Number.isFinite(input.maxFrames)
    ? Math.floor(input.maxFrames)
    : WATCH_FRAME_DEFAULT_MAX;
  const cap = Math.max(1, Math.min(requestedCap, WATCH_FRAME_HARD_CAP));
  const rateCap = Math.max(1, Math.floor((rangeMs / 1000) * MAX_FRAME_RATE_PER_SECOND));
  const frameCount = Math.min(budgetForRange(rangeMs, focused), cap, rateCap);

  return Array.from({ length: frameCount }, (_, index) =>
    Math.round(startMs + ((index + 0.5) * rangeMs) / frameCount)
  );
}

export type ExtractedFrame = {
  readonly timeMs: number;
  readonly jpegBase64: string;
};

export type ExtractFramesInput = {
  readonly ffmpegPath: string;
  readonly filePath: string;
  readonly timestampsMs: readonly number[];
};

function runFfmpegFrame(ffmpegPath: string, filePath: string, timeMs: number, outFile: string): Promise<void> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(ffmpegPath, [
      '-hide_banner',
      '-loglevel', 'error',
      '-ss', (timeMs / 1000).toFixed(3),
      '-i', filePath,
      '-frames:v', '1',
      '-vf', `scale=${WATCH_FRAME_WIDTH_PX}:-2`,
      '-q:v', '6',
      '-y',
      outFile
    ], { stdio: ['ignore', 'ignore', 'pipe'] });

    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = `${stderr}${chunk.toString()}`.slice(-2000);
    });
    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
      rejectPromise(new Error(`FFmpeg frame extraction timed out at ${timeMs}ms.`));
    }, FFMPEG_FRAME_TIMEOUT_MS);
    child.on('error', (error) => {
      clearTimeout(timeout);
      rejectPromise(error);
    });
    child.on('close', (code) => {
      clearTimeout(timeout);
      if (code === 0) {
        resolvePromise();
        return;
      }
      rejectPromise(new Error(`FFmpeg exited with code ${code ?? 'unknown'}${stderr ? `: ${stderr.trim().slice(0, 300)}` : ''}.`));
    });
  });
}

/**
 * Extract one JPEG per planned timestamp into a private temp dir, return them
 * base64-encoded, and always clean the temp dir up. Timestamps past the end of
 * the stream simply produce no frame and are skipped.
 */
export async function extractVideoFrames(input: ExtractFramesInput): Promise<readonly ExtractedFrame[]> {
  if (input.timestampsMs.length === 0) return [];
  const workDir = await mkdtemp(join(tmpdir(), 'openvideo-watch-'));
  try {
    const frames: ExtractedFrame[] = [];
    for (const [index, timeMs] of input.timestampsMs.entries()) {
      const outFile = join(workDir, `frame-${index}.jpg`);
      await runFfmpegFrame(input.ffmpegPath, input.filePath, timeMs, outFile);
      try {
        frames.push({ timeMs, jpegBase64: (await readFile(outFile)).toString('base64') });
      } catch {
        // ffmpeg can exit 0 without an output frame when seeking past EOF.
      }
    }
    return frames;
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

export function formatFrameTimestamp(timeMs: number): string {
  const totalSeconds = Math.floor(timeMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}
