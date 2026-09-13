import { EventEmitter } from 'node:events';
import { chmod, mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildVieNeuChildEnvironment, ManagedVieNeuRuntime, resolveVieNeuLaunch } from '../src/main/managedVieNeuRuntime';

const temporaryDirectories: string[] = [];
afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function createVieNeuFixture(): Promise<{ workingDirectory: string; projectDirectory: string; pythonPath: string }> {
  const root = await mkdtemp(join(tmpdir(), 'openscene-vieneu-runtime-'));
  temporaryDirectories.push(root);
  const canonicalRoot = await realpath(root);
  const workingDirectory = join(canonicalRoot, 'OpenScene');
  const projectDirectory = join(canonicalRoot, 'VieNeu-TTS');
  const pythonPath = process.platform === 'win32'
    ? join(projectDirectory, '.venv', 'Scripts', 'python.exe')
    : join(projectDirectory, '.venv', 'bin', 'python3');
  await mkdir(join(projectDirectory, 'apps'), { recursive: true });
  await mkdir(join(pythonPath, '..'), { recursive: true });
  await mkdir(workingDirectory, { recursive: true });
  await writeFile(join(projectDirectory, 'apps', 'web_stream.py'), '# fixture');
  await writeFile(pythonPath, 'fixture');
  if (process.platform !== 'win32') await chmod(pythonPath, 0o755);
  return { workingDirectory, projectDirectory, pythonPath };
}

function mockChild() {
  const child = new EventEmitter() as ChildProcessWithoutNullStreams;
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  Object.assign(child, {
    stdout,
    stderr,
    stdin: new PassThrough(),
    pid: 4242,
    exitCode: null,
    signalCode: null
  });
  const kill = vi.fn(() => {
    Object.assign(child, { signalCode: 'SIGTERM' });
    queueMicrotask(() => child.emit('close', null, 'SIGTERM'));
    return true;
  });
  Object.assign(child, { kill });
  return { child, stdout, stderr, kill };
}

describe('managed VieNeu runtime', () => {
  it('passes only runtime necessities to Python and never unrelated provider secrets', () => {
    expect(buildVieNeuChildEnvironment({
      Path: 'C:\\Windows',
      USERPROFILE: 'C:\\Users\\Example',
      VIENEU_PRECISION: 'fp32',
      GEMINI_API_KEY: 'must-not-leak',
      AGENTROUTER_API_KEY: 'must-not-leak'
    })).toEqual({
      Path: 'C:\\Windows',
      USERPROFILE: 'C:\\Users\\Example',
      VIENEU_PRECISION: 'fp32',
      PYTHONUNBUFFERED: '1',
      PYTHONUTF8: '1',
      PYTHONIOENCODING: 'utf-8'
    });
  });

  it('discovers a sibling checkout with an installed virtual environment', async () => {
    const fixture = await createVieNeuFixture();
    await expect(resolveVieNeuLaunch({ workingDirectory: fixture.workingDirectory })).resolves.toEqual({
      projectDirectory: fixture.projectDirectory,
      pythonPath: fixture.pythonPath
    });
  });

  it('starts once, waits for loopback health, and stops only its owned child', async () => {
    const fixture = await createVieNeuFixture();
    const processFixture = mockChild();
    let healthChecks = 0;
    const fetchImpl = vi.fn(async () => {
      healthChecks += 1;
      return new Response('', { status: healthChecks >= 2 ? 200 : 503 });
    }) as typeof fetch;
    const spawnProcess = vi.fn(() => processFixture.child);
    const runtime = new ManagedVieNeuRuntime({
      workingDirectory: fixture.workingDirectory,
      fetchImpl,
      spawnProcess,
      startupTimeoutMs: 1_000,
      healthRetryMs: 1
    });

    await Promise.all([runtime.ensureReady(), runtime.ensureReady()]);
    expect(spawnProcess).toHaveBeenCalledTimes(1);
    expect(spawnProcess).toHaveBeenCalledWith(fixture.pythonPath, ['-m', 'apps.web_stream'], expect.objectContaining({
      cwd: fixture.projectDirectory,
      env: expect.objectContaining({ PYTHONUNBUFFERED: '1', PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' }),
      shell: false,
      windowsHide: true
    }));
    runtime.stop();
    expect(processFixture.kill).toHaveBeenCalledWith('SIGTERM');
  });

  it('reuses a healthy existing server without taking ownership of a process', async () => {
    const spawnProcess = vi.fn();
    const runtime = new ManagedVieNeuRuntime({
      fetchImpl: vi.fn(async () => new Response('[]', { status: 200 })) as typeof fetch,
      spawnProcess
    });
    await runtime.ensureReady();
    runtime.stop();
    expect(spawnProcess).not.toHaveBeenCalled();
  });

  it('fails clearly when automatic startup is disabled', async () => {
    const runtime = new ManagedVieNeuRuntime({
      environment: { OPENSCENE_VIENEU_AUTOSTART: 'false' },
      fetchImpl: vi.fn(async () => { throw new Error('offline'); }) as typeof fetch
    });
    await expect(runtime.ensureReady()).rejects.toThrow('automatic startup is disabled');
  });

  it('does not launch the fixed-port demo for a different loopback endpoint', async () => {
    const spawnProcess = vi.fn();
    const runtime = new ManagedVieNeuRuntime({
      environment: { OPENSCENE_VIENEU_BASE_URL: 'http://127.0.0.1:9000' },
      fetchImpl: vi.fn(async () => { throw new Error('offline'); }) as typeof fetch,
      spawnProcess
    });
    await expect(runtime.ensureReady()).rejects.toThrow('port 8001');
    expect(spawnProcess).not.toHaveBeenCalled();
  });
});
