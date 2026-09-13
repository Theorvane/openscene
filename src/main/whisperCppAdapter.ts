import { spawn, type ChildProcessWithoutNullStreams, type SpawnOptionsWithoutStdio } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants, createReadStream, createWriteStream } from 'node:fs';
import { access, lstat, mkdtemp, readFile, realpath, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, extname, isAbsolute, join } from 'node:path';
import { pipeline } from 'node:stream/promises';

import type { SubtitleCue } from '../shared/narrationPlan';
import type { WhisperCppRuntimeStatus } from '../shared/transcription';
import type { OpenedAssetPlaybackSource } from './assetLibraryStore';

const PROCESS_OUTPUT_LIMIT = 16_384;
const HEALTH_TIMEOUT_MS = 8_000;
const NORMALIZE_TIMEOUT_MS = 10 * 60 * 1_000;
const TRANSCRIBE_TIMEOUT_MS = 60 * 60 * 1_000;
const KILL_DELAY_MS = 1_000;
export const MANAGED_WHISPER_RELEASE = 'b4938';
export const MANAGED_WHISPER_MODEL_SHA256 = '1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b';

export type WhisperCppRuntime = {
  readonly executablePath: string;
  readonly modelPath: string;
  readonly executableName: string;
  readonly modelName: string;
  readonly version: string;
  readonly checksumVerified: boolean;
};

export type SpawnWhisperProcess = (
  executablePath: string,
  args: readonly string[],
  options: SpawnOptionsWithoutStdio
) => ChildProcessWithoutNullStreams;

type ProcessResult = { readonly stdout: string; readonly stderr: string };

export class WhisperCppProcessError extends Error {
  override readonly name = 'WhisperCppProcessError';
  constructor(message: string, readonly diagnostics = '') { super(message); }
}

function appendBounded(current: string, chunk: string): string {
  const remaining = PROCESS_OUTPUT_LIMIT - current.length;
  return remaining > 0 ? current + chunk.slice(0, remaining) : current;
}

async function runProcess(input: {
  readonly executablePath: string;
  readonly args: readonly string[];
  readonly timeoutMs: number;
  readonly signal?: AbortSignal;
  readonly spawnProcess?: SpawnWhisperProcess;
  readonly onOutput?: (chunk: string) => void;
}): Promise<ProcessResult> {
  if (input.signal?.aborted) throw new WhisperCppProcessError('Transcription was cancelled.');
  const child = (input.spawnProcess ?? spawn)(input.executablePath, [...input.args], { shell: false, windowsHide: true });
  let stdout = '';
  let stderr = '';
  let timedOut = false;
  let cancelled = false;
  let forceKillTimer: NodeJS.Timeout | undefined;
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => { stdout = appendBounded(stdout, chunk); input.onOutput?.(chunk); });
  child.stderr.on('data', (chunk: string) => { stderr = appendBounded(stderr, chunk); input.onOutput?.(chunk); });
  const stop = (): void => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    child.kill('SIGTERM');
    forceKillTimer = setTimeout(() => child.kill('SIGKILL'), KILL_DELAY_MS);
  };
  const onAbort = (): void => { cancelled = true; stop(); };
  input.signal?.addEventListener('abort', onAbort, { once: true });
  const timeout = setTimeout(() => { timedOut = true; stop(); }, input.timeoutMs);
  try {
    return await new Promise<ProcessResult>((resolve, reject) => {
      let settled = false;
      const settle = (callback: () => void): void => {
        if (settled) return;
        settled = true;
        callback();
      };
      child.once('error', (error) => settle(() => reject(new WhisperCppProcessError(
        cancelled ? 'Transcription was cancelled.' : 'The local process could not be started.',
        error.message
      ))));
      child.once('close', (code) => settle(() => {
        const diagnostics = (stderr || stdout).trim();
        if (cancelled) reject(new WhisperCppProcessError('Transcription was cancelled.', diagnostics));
        else if (timedOut) reject(new WhisperCppProcessError(`The local process exceeded ${Math.round(input.timeoutMs / 60_000)} minute(s).`, diagnostics));
        else if (code !== 0) reject(new WhisperCppProcessError(`The local process exited with code ${String(code)}.`, diagnostics));
        else resolve({ stdout, stderr });
      }));
    });
  } finally {
    clearTimeout(timeout);
    if (forceKillTimer !== undefined) clearTimeout(forceKillTimer);
    input.signal?.removeEventListener('abort', onAbort);
  }
}

async function configuredRegularFile(path: string, executable: boolean): Promise<string | null> {
  if (!isAbsolute(path) || path.includes('\0')) return null;
  try {
    const before = await lstat(path);
    if (before.isSymbolicLink() || !before.isFile()) return null;
    const resolved = await realpath(path);
    const after = await stat(resolved);
    if (!after.isFile() || before.dev !== after.dev || before.ino !== after.ino) return null;
    await access(resolved, executable && process.platform !== 'win32' ? constants.X_OK : constants.R_OK);
    return resolved;
  } catch {
    return null;
  }
}

async function sha256(path: string): Promise<string> {
  const hash = createHash('sha256');
  await pipeline(createReadStream(path), hash);
  return hash.digest('hex');
}

export async function resolveWhisperCppRuntime(options: {
  readonly environment?: Readonly<Record<string, string | undefined>>;
  readonly spawnProcess?: SpawnWhisperProcess;
  readonly workingDirectory?: string;
} = {}): Promise<{ readonly status: WhisperCppRuntimeStatus; readonly runtime?: WhisperCppRuntime }> {
  const environment = options.environment ?? process.env;
  const explicitExecutable = environment.OPENSCENE_WHISPER_CPP_PATH?.trim() ?? '';
  const explicitModel = environment.OPENSCENE_WHISPER_MODEL_PATH?.trim() ?? '';
  if (Boolean(explicitExecutable) !== Boolean(explicitModel)) {
    return { status: { ready: false, checksumVerified: false, reason: 'Configure both OPENSCENE_WHISPER_CPP_PATH and OPENSCENE_WHISPER_MODEL_PATH, or remove both to use the managed runtime.' } };
  }
  const managedRoot = join(options.workingDirectory ?? process.cwd(), '.local-runtimes', 'whisper.cpp', MANAGED_WHISPER_RELEASE);
  const managed = !explicitExecutable && !explicitModel;
  const executableName = process.platform === 'win32' ? 'whisper-cli.exe' : 'whisper-cli';
  const preferCuda = /^(1|true|yes|on)$/iu.test(environment.OPENSCENE_WHISPER_CUDA?.trim() ?? '');
  const managedExecutableConfigs = preferCuda
    ? [join(managedRoot, 'bin-cuda', 'Release', executableName), join(managedRoot, 'bin', 'Release', executableName)]
    : [join(managedRoot, 'bin', 'Release', executableName), join(managedRoot, 'bin-cuda', 'Release', executableName)];
  const executableConfigs = explicitExecutable
    ? [explicitExecutable]
    : managedExecutableConfigs;
  const modelConfig = explicitModel || join(managedRoot, 'models', 'ggml-small.bin');
  const executablePaths = (await Promise.all(executableConfigs.map((path) => configuredRegularFile(path, true)))).filter((path): path is string => path !== null);
  const executablePath = executablePaths[0];
  if (executablePath === undefined) return { status: { ready: false, checksumVerified: false, reason: managed ? 'The managed whisper.cpp runtime is not installed. Run "npm run setup:local-ai", then restart OpenScene.' : 'The configured whisper.cpp executable is not a regular accessible file.' } };
  const modelPath = await configuredRegularFile(modelConfig, false);
  if (modelPath === null) return { status: { ready: false, checksumVerified: false, executableName: basename(executablePath), reason: managed ? 'The managed Whisper model is not installed. Run "npm run setup:local-ai", then restart OpenScene.' : 'The configured whisper.cpp model is not a regular readable file.' } };

  const checksumConfig = environment.OPENSCENE_WHISPER_MODEL_SHA256?.trim().toLowerCase() ?? '';
  const expectedChecksum = checksumConfig || (managed ? MANAGED_WHISPER_MODEL_SHA256 : undefined);
  if (expectedChecksum !== undefined && !/^[0-9a-f]{64}$/.test(expectedChecksum)) {
    return { status: { ready: false, checksumVerified: false, executableName: basename(executablePath), modelName: basename(modelPath), reason: 'OPENSCENE_WHISPER_MODEL_SHA256 must contain exactly 64 hexadecimal characters.' } };
  }
  let checksumVerified = false;
  if (expectedChecksum !== undefined) {
    if (await sha256(modelPath) !== expectedChecksum) {
      return { status: { ready: false, checksumVerified: false, executableName: basename(executablePath), modelName: basename(modelPath), reason: 'The configured Whisper model checksum does not match.' } };
    }
    checksumVerified = true;
  }
  let lastError: unknown;
  for (const candidate of executablePaths) {
    try {
      const result = await runProcess({ executablePath: candidate, args: ['--version'], timeoutMs: HEALTH_TIMEOUT_MS, ...(options.spawnProcess === undefined ? {} : { spawnProcess: options.spawnProcess }) });
      const version = (result.stdout || result.stderr).trim().slice(0, 200) || 'version unavailable';
      const runtime = { executablePath: candidate, modelPath, executableName: basename(candidate), modelName: basename(modelPath), version, checksumVerified };
      return { status: { ready: true, executableName: runtime.executableName, modelName: runtime.modelName, version, checksumVerified }, runtime };
    } catch (error) {
      lastError = error;
    }
  }
  return { status: { ready: false, checksumVerified, executableName: basename(executablePath), modelName: basename(modelPath), reason: lastError instanceof Error ? lastError.message : 'whisper.cpp health check failed.' } };
}

function parseClock(value: string): number | null {
  const match = /^(\d{2}):(\d{2}):(\d{2})[,.](\d{3})$/.exec(value.trim());
  if (match === null) return null;
  const hours = Number(match[1]); const minutes = Number(match[2]); const seconds = Number(match[3]); const millis = Number(match[4]);
  if (minutes > 59 || seconds > 59) return null;
  return ((hours * 60 + minutes) * 60 + seconds) * 1_000 + millis;
}

export function parseWhisperSrt(value: string): readonly SubtitleCue[] {
  const blocks = value.replace(/^\uFEFF/u, '').trim().split(/\r?\n\s*\r?\n/u).filter(Boolean);
  const cues: SubtitleCue[] = [];
  for (const [index, block] of blocks.entries()) {
    const lines = block.split(/\r?\n/u);
    const timingIndex = lines.findIndex((line) => line.includes('-->'));
    if (timingIndex < 0) throw new WhisperCppProcessError(`Subtitle block ${index + 1} has no timestamp.`);
    const timing = /^\s*(\d{2}:\d{2}:\d{2}[,.]\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}[,.]\d{3})\s*$/.exec(lines[timingIndex]!);
    const startMs = timing === null ? null : parseClock(timing[1]!);
    const endMs = timing === null ? null : parseClock(timing[2]!);
    const text = lines.slice(timingIndex + 1).join('\n').trim();
    if (startMs === null || endMs === null || endMs <= startMs || !text || text.length > 500) {
      throw new WhisperCppProcessError(`Subtitle block ${index + 1} is malformed.`);
    }
    if (cues.length > 0 && startMs < cues[cues.length - 1]!.endMs) {
      throw new WhisperCppProcessError(`Subtitle block ${index + 1} overlaps the previous block.`);
    }
    cues.push({ id: `transcript-cue-${index + 1}`, text, startMs, endMs });
  }
  if (cues.length === 0) throw new WhisperCppProcessError('Whisper did not detect any spoken subtitle segments.');
  return cues;
}

export async function transcribeOpenedAsset(input: {
  readonly source: OpenedAssetPlaybackSource;
  readonly sourceFileName: string;
  readonly ffmpegPath: string;
  readonly runtime: WhisperCppRuntime;
  readonly language: string;
  readonly signal: AbortSignal;
  readonly temporaryRoot?: string;
  readonly spawnProcess?: SpawnWhisperProcess;
  readonly onStage: (stage: 'normalizing' | 'transcribing') => void;
  readonly onProgress: (percent: number) => void;
}): Promise<readonly SubtitleCue[]> {
  const temporaryDirectory = await mkdtemp(join(input.temporaryRoot ?? tmpdir(), 'openscene-whisper-'));
  const sourcePath = join(temporaryDirectory, `source${extname(input.sourceFileName) || '.media'}`);
  const normalizedPath = join(temporaryDirectory, 'normalized.wav');
  const outputPrefix = join(temporaryDirectory, 'transcript');
  try {
    await pipeline(input.source.file.createReadStream({ autoClose: false }), createWriteStream(sourcePath, { flags: 'wx', mode: 0o600 }));
    await input.source.file.close();
    input.onStage('normalizing');
    await runProcess({
      executablePath: input.ffmpegPath,
      args: ['-nostdin', '-hide_banner', '-loglevel', 'error', '-y', '-i', sourcePath, '-map', '0:a:0', '-vn', '-c:a', 'pcm_s16le', '-ar', '16000', '-ac', '1', normalizedPath],
      timeoutMs: NORMALIZE_TIMEOUT_MS,
      signal: input.signal,
      ...(input.spawnProcess === undefined ? {} : { spawnProcess: input.spawnProcess })
    });
    input.onProgress(20);
    input.onStage('transcribing');
    await runProcess({
      executablePath: input.runtime.executablePath,
      args: ['-m', input.runtime.modelPath, '-f', normalizedPath, '-l', input.language, '-osrt', '-of', outputPrefix, '-pp'],
      timeoutMs: TRANSCRIBE_TIMEOUT_MS,
      signal: input.signal,
      ...(input.spawnProcess === undefined ? {} : { spawnProcess: input.spawnProcess }),
      onOutput: (chunk) => {
        const matches = [...chunk.matchAll(/progress\s*=\s*(\d{1,3})%/gu)];
        const latest = matches.at(-1);
        if (latest !== undefined) input.onProgress(20 + Math.round(Math.min(100, Number(latest[1])) * 0.79));
      }
    });
    const cues = parseWhisperSrt(await readFile(`${outputPrefix}.srt`, 'utf8'));
    input.onProgress(100);
    return cues;
  } finally {
    await input.source.file.close().catch(() => undefined);
    await rm(temporaryDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 }).catch(() => undefined);
  }
}
