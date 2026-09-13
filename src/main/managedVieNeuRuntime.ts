import { spawn, type ChildProcessWithoutNullStreams, type SpawnOptionsWithoutStdio } from 'node:child_process';
import { constants } from 'node:fs';
import { access, lstat, realpath, stat } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';

import { resolveVieNeuBaseUrl } from './mediaGenerationAdapters';

const STARTUP_TIMEOUT_MS = 10 * 60_000;
const HEALTH_TIMEOUT_MS = 2_000;
const HEALTH_RETRY_MS = 1_000;
const DIAGNOSTIC_LIMIT = 16_384;

export type VieNeuRuntimeController = {
  readonly ensureReady: () => Promise<void>;
};

type SpawnRuntimeProcess = (
  executablePath: string,
  args: readonly string[],
  options: SpawnOptionsWithoutStdio
) => ChildProcessWithoutNullStreams;

type ManagedVieNeuRuntimeOptions = {
  readonly environment?: Readonly<Record<string, string | undefined>>;
  readonly workingDirectory?: string;
  readonly fetchImpl?: typeof fetch;
  readonly spawnProcess?: SpawnRuntimeProcess;
  readonly startupTimeoutMs?: number;
  readonly healthRetryMs?: number;
};

type VieNeuLaunch = { readonly projectDirectory: string; readonly pythonPath: string };

const CHILD_ENVIRONMENT_ALLOWLIST = [
  'PATH', 'Path', 'SYSTEMROOT', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP',
  'USERPROFILE', 'LOCALAPPDATA', 'APPDATA', 'PROGRAMDATA', 'HOMEDRIVE', 'HOMEPATH',
  'HOME', 'XDG_CACHE_HOME', 'LANG', 'LC_ALL', 'SSL_CERT_FILE', 'REQUESTS_CA_BUNDLE',
  'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'HF_HOME', 'HF_HUB_CACHE',
  'HUGGINGFACE_HUB_CACHE', 'TRANSFORMERS_CACHE', 'OMP_NUM_THREADS',
  'VIENEU_PRECISION', 'VIENEU_ONNX_DIR'
] as const;

function log(event: string, details: Readonly<Record<string, unknown>> = {}, level: 'info' | 'error' = 'info'): void {
  const suffix = Object.keys(details).length > 0 ? ` ${JSON.stringify(details)}` : '';
  console[level](`[OpenScene][VieNeu Runtime] ${event}${suffix}`);
}

function autostartEnabled(environment: Readonly<Record<string, string | undefined>>): boolean {
  const configured = environment.OPENSCENE_VIENEU_AUTOSTART?.trim().toLowerCase();
  return configured === undefined || !['0', 'false', 'off', 'no'].includes(configured);
}

export function buildVieNeuChildEnvironment(environment: Readonly<Record<string, string | undefined>>): NodeJS.ProcessEnv {
  const childEnvironment: NodeJS.ProcessEnv = {};
  for (const key of CHILD_ENVIRONMENT_ALLOWLIST) {
    const value = environment[key];
    if (typeof value === 'string' && value.length > 0) childEnvironment[key] = value;
  }
  return {
    ...childEnvironment,
    PYTHONUNBUFFERED: '1',
    PYTHONUTF8: '1',
    PYTHONIOENCODING: 'utf-8'
  };
}

async function regularFile(path: string, executable = false): Promise<string | null> {
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

async function regularDirectory(path: string): Promise<string | null> {
  if (!isAbsolute(path) || path.includes('\0')) return null;
  try {
    const before = await lstat(path);
    if (before.isSymbolicLink() || !before.isDirectory()) return null;
    const resolved = await realpath(path);
    const after = await stat(resolved);
    return after.isDirectory() && before.dev === after.dev && before.ino === after.ino ? resolved : null;
  } catch {
    return null;
  }
}

export async function resolveVieNeuLaunch(options: {
  readonly environment?: Readonly<Record<string, string | undefined>>;
  readonly workingDirectory?: string;
} = {}): Promise<VieNeuLaunch | null> {
  const environment = options.environment ?? process.env;
  const workingDirectory = resolve(options.workingDirectory ?? process.cwd());
  const configured = environment.OPENSCENE_VIENEU_PROJECT_DIR?.trim();
  const candidates = configured
    ? [configured]
    : [resolve(workingDirectory, '..', 'VieNeu-TTS'), resolve(workingDirectory, 'VieNeu-TTS')];
  for (const candidate of candidates) {
    if (!isAbsolute(candidate)) continue;
    const projectDirectory = await regularDirectory(candidate);
    if (projectDirectory === null || await regularFile(join(projectDirectory, 'apps', 'web_stream.py')) === null) continue;
    const pythonCandidates = process.platform === 'win32'
      ? [join(projectDirectory, '.venv', 'Scripts', 'python.exe')]
      : [join(projectDirectory, '.venv', 'bin', 'python3'), join(projectDirectory, '.venv', 'bin', 'python')];
    for (const pythonCandidate of pythonCandidates) {
      const pythonPath = await regularFile(pythonCandidate, true);
      if (pythonPath !== null) return { projectDirectory, pythonPath };
    }
  }
  return null;
}

function appendDiagnostic(current: string, chunk: string): string {
  const combined = `${current}${chunk}`;
  return combined.length <= DIAGNOSTIC_LIMIT ? combined : combined.slice(-DIAGNOSTIC_LIMIT);
}

function forwardOutput(stream: NodeJS.ReadableStream, name: 'stdout' | 'stderr', onChunk: (chunk: string) => void): void {
  stream.setEncoding('utf8');
  let pending = '';
  stream.on('data', (value: string) => {
    onChunk(value);
    pending += value;
    const lines = pending.split(/\r?\n/u);
    pending = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.trim()) continue;
      const level = name === 'stderr' && !line.startsWith('INFO:') ? 'error' : 'info';
      log(`process.${name}`, { message: line.slice(0, 1_000) }, level);
    }
  });
  stream.on('end', () => {
    if (pending.trim()) {
      const level = name === 'stderr' && !pending.startsWith('INFO:') ? 'error' : 'info';
      log(`process.${name}`, { message: pending.slice(0, 1_000) }, level);
    }
  });
}

export class ManagedVieNeuRuntime implements VieNeuRuntimeController {
  private readonly environment: Readonly<Record<string, string | undefined>>;
  private readonly workingDirectory: string;
  private readonly fetchImpl: typeof fetch;
  private readonly spawnProcess: SpawnRuntimeProcess;
  private readonly startupTimeoutMs: number;
  private readonly healthRetryMs: number;
  private child: ChildProcessWithoutNullStreams | undefined;
  private readiness: Promise<void> | undefined;
  private stopping = false;

  constructor(options: ManagedVieNeuRuntimeOptions = {}) {
    this.environment = options.environment ?? process.env;
    this.workingDirectory = options.workingDirectory ?? process.cwd();
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.spawnProcess = options.spawnProcess ?? spawn;
    this.startupTimeoutMs = options.startupTimeoutMs ?? STARTUP_TIMEOUT_MS;
    this.healthRetryMs = options.healthRetryMs ?? HEALTH_RETRY_MS;
  }

  warmUp(): void {
    if (!autostartEnabled(this.environment)) {
      log('autostart.disabled');
      return;
    }
    void this.ensureReady().catch((error: unknown) => {
      log('startup.failed', { error: error instanceof Error ? error.message : 'VieNeu startup failed.' }, 'error');
    });
  }

  async ensureReady(): Promise<void> {
    const baseUrl = resolveVieNeuBaseUrl(this.environment.OPENSCENE_VIENEU_BASE_URL);
    if (await this.isHealthy(baseUrl)) {
      log('server.reused', { baseUrl });
      return;
    }
    if (!autostartEnabled(this.environment)) {
      throw new Error('VieNeu-TTS is not running and automatic startup is disabled. Set OPENSCENE_VIENEU_AUTOSTART=true and restart OpenScene.');
    }
    if (this.readiness !== undefined) return this.readiness;
    const readiness = this.startAndWait(baseUrl);
    this.readiness = readiness;
    try {
      await readiness;
    } finally {
      if (this.readiness === readiness) this.readiness = undefined;
    }
  }

  stop(): void {
    this.stopping = true;
    const child = this.child;
    this.child = undefined;
    if (child !== undefined && child.exitCode === null && child.signalCode === null) {
      log('process.stopping', { pid: child.pid });
      child.kill('SIGTERM');
    }
  }

  private async startAndWait(baseUrl: string): Promise<void> {
    let child = this.child;
    if (child === undefined || child.exitCode !== null || child.signalCode !== null) {
      const launchUrl = new URL(baseUrl);
      const launchPort = launchUrl.port || '80';
      if (launchPort !== '8001' || launchUrl.hostname.toLowerCase() === '[::1]') {
        throw new Error('Automatic VieNeu startup supports 127.0.0.1 or localhost on port 8001. Start a custom loopback server yourself or restore OPENSCENE_VIENEU_BASE_URL to the default.');
      }
      const launch = await resolveVieNeuLaunch({ environment: this.environment, workingDirectory: this.workingDirectory });
      if (launch === null) {
        throw new Error('VieNeu-TTS runtime is not installed. Place VieNeu-TTS beside OpenScene, run "npm run setup:local-ai", then restart the app.');
      }
      this.stopping = false;
      log('process.starting', { projectDirectory: launch.projectDirectory, baseUrl });
      child = this.spawnProcess(launch.pythonPath, ['-m', 'apps.web_stream'], {
        cwd: launch.projectDirectory,
        env: buildVieNeuChildEnvironment(this.environment),
        shell: false,
        windowsHide: true
      });
      this.child = child;
      let diagnostics = '';
      forwardOutput(child.stdout, 'stdout', (chunk) => { diagnostics = appendDiagnostic(diagnostics, chunk); });
      forwardOutput(child.stderr, 'stderr', (chunk) => { diagnostics = appendDiagnostic(diagnostics, chunk); });
      child.once('error', (error) => log('process.error', { error: error.message }, 'error'));
      child.once('close', (code, signal) => {
        if (this.child === child) this.child = undefined;
        log(this.stopping ? 'process.stopped' : 'process.exited', { code, signal }, this.stopping ? 'info' : 'error');
      });
      await this.waitUntilHealthy(baseUrl, child, () => diagnostics);
      log('server.ready', { pid: child.pid, baseUrl });
      return;
    }
    await this.waitUntilHealthy(baseUrl, child, () => '');
  }

  private async waitUntilHealthy(baseUrl: string, child: ChildProcessWithoutNullStreams, diagnostics: () => string): Promise<void> {
    const startedAt = Date.now();
    let nextProgressLog = 0;
    while (Date.now() - startedAt < this.startupTimeoutMs) {
      if (child.exitCode !== null || child.signalCode !== null) {
        const detail = diagnostics().trim().slice(-2_000);
        throw new Error(`VieNeu-TTS exited before it became ready${detail ? `: ${detail}` : '.'}`);
      }
      if (await this.isHealthy(baseUrl)) return;
      const elapsedSeconds = Math.round((Date.now() - startedAt) / 1_000);
      if (elapsedSeconds >= nextProgressLog) {
        log('process.working', { pid: child.pid, elapsedSeconds });
        nextProgressLog = elapsedSeconds + 10;
      }
      await new Promise((resolvePromise) => setTimeout(resolvePromise, this.healthRetryMs));
    }
    child.kill('SIGTERM');
    throw new Error(`VieNeu-TTS did not become ready within ${Math.round(this.startupTimeoutMs / 1_000)} seconds.`);
  }

  private async isHealthy(baseUrl: string): Promise<boolean> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
    try {
      const response = await this.fetchImpl(`${baseUrl}/voices`, { method: 'GET', signal: controller.signal });
      return response.ok;
    } catch {
      return false;
    } finally {
      clearTimeout(timeout);
    }
  }
}
