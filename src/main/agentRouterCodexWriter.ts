import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, delimiter, dirname, extname, join, resolve } from 'node:path';

import {
  AGENT_ROUTER_BASE_URL,
  agentRouterNativeModelId,
  isAgentRouterModelId
} from '../shared/agentRouter';
import {
  writerResponseSchema,
  writerSystemPrompt,
  compileWriterPrompt,
  parseWriterRequest,
  validateWriterResponse,
  type WriterDraft,
  type WriterGenerationInput,
  type WriterRequest
} from '../shared/writerWorkflow';

const AGENT_ROUTER_CODEX_TIMEOUT_MS = 360_000;
const AGENT_ROUTER_STREAM_IDLE_TIMEOUT_MS = 300_000;
const AGENT_ROUTER_HEARTBEAT_MS = 10_000;
const MAX_CLI_OUTPUT_BYTES = 16 * 1024 * 1024;
const TEMP_DIRECTORY_PREFIX = 'openscene-agentrouter-codex-';
const RESULT_FILE_NAME = 'writer-result.json';
const SCHEMA_FILE_NAME = 'writer-schema.json';

export type AgentRouterCodexProgressEvent =
  | { readonly type: 'started'; readonly pid?: number }
  | { readonly type: 'codex_event'; readonly eventType: string; readonly itemType?: string }
  | { readonly type: 'heartbeat'; readonly elapsedMs: number; readonly stdoutBytes: number; readonly stderrBytes: number }
  | { readonly type: 'timeout'; readonly elapsedMs: number }
  | { readonly type: 'output_limit'; readonly outputBytes: number }
  | {
      readonly type: 'closed';
      readonly exitCode: number | null;
      readonly elapsedMs: number;
      readonly stdoutBytes: number;
      readonly stderrBytes: number;
    }
  | { readonly type: 'process_error'; readonly message: string };

type CliRunInput = {
  readonly executable: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  readonly stdin: string;
  readonly timeoutMs: number;
  readonly maxOutputBytes: number;
  readonly onProgress?: (event: AgentRouterCodexProgressEvent) => void;
};

type CliRunResult = {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
};

export type AgentRouterCodexRunner = (input: CliRunInput) => Promise<CliRunResult>;

export type AgentRouterCodexWriterInput = WriterGenerationInput & {
  readonly apiKey: string;
  readonly executable?: string;
  readonly runCli?: AgentRouterCodexRunner;
  readonly removeTempDirectory?: (path: string) => Promise<void>;
};

type DiagnosticFields = Readonly<Record<string, string | number | boolean | null | undefined>>;

function terminalLog(
  runId: string,
  level: 'info' | 'warn' | 'error',
  event: string,
  fields: DiagnosticFields = {}
): void {
  const present = Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined));
  const suffix = Object.keys(present).length === 0 ? '' : ` ${JSON.stringify(present)}`;
  console[level](`[OpenScene][AgentRouter Writer][${runId}] ${event}${suffix}`);
}

function safeDetail(value: string, secret: string, privateText: readonly string[] = []): string {
  let redacted = value.replaceAll(secret, '[REDACTED]');
  for (const text of privateText) {
    if (text.length > 0) redacted = redacted.replaceAll(text, '[REDACTED_INPUT]');
  }
  return redacted.replace(/\u001b\[[0-9;]*m/g, '').trim().slice(0, 500);
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/** Resolve the native Codex binary without invoking a command shell. */
export async function resolveCodexExecutable(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  architecture: string = process.arch
): Promise<string> {
  const configured = env.CODEX_CLI_EXECUTABLE?.trim();
  if (configured) {
    if (platform === 'win32' && extname(configured).toLowerCase() !== '.exe') {
      throw new Error('CODEX_CLI_EXECUTABLE must point to the native codex.exe, not a shell wrapper.');
    }
    if (await fileExists(configured)) return configured;
    throw new Error('CODEX_CLI_EXECUTABLE does not point to an installed Codex executable.');
  }
  if (platform !== 'win32') return 'codex';

  const appData = env.APPDATA?.trim();
  const searchPath = env.Path ?? env.PATH ?? '';
  const target = architecture === 'arm64'
    ? { packageName: 'codex-win32-arm64', vendor: 'aarch64-pc-windows-msvc' }
    : { packageName: 'codex-win32-x64', vendor: 'x86_64-pc-windows-msvc' };
  const candidates = [
    ...(appData ? [join(
      appData, 'npm', 'node_modules', '@openai', 'codex', 'node_modules', '@openai', target.packageName,
      'vendor', target.vendor, 'bin', 'codex.exe'
    )] : []),
    ...searchPath.split(delimiter).filter(Boolean).map((directory) => join(directory, 'codex.exe'))
  ];
  for (const candidate of [...new Set(candidates)]) {
    if (await fileExists(candidate)) return candidate;
  }
  throw new Error('Codex CLI was not found. Install it with "npm install -g @openai/codex", restart OpenScene, and try again.');
}

export const runAgentRouterCodex: AgentRouterCodexRunner = async (input) =>
  new Promise<CliRunResult>((resolveResult, reject) => {
    const startedAt = Date.now();
    const emit = (event: AgentRouterCodexProgressEvent): void => {
      try {
        input.onProgress?.(event);
      } catch {
        // Diagnostics must never change the generation result.
      }
    };
    const child = spawn(input.executable, [...input.args], {
      cwd: input.cwd,
      env: input.env,
      shell: false,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let outputBytes = 0;
    let stdoutLineBuffer = '';
    let settled = false;

    emit({ type: 'started', ...(child.pid === undefined ? {} : { pid: child.pid }) });

    const rejectOnce = (error: Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearInterval(heartbeat);
      child.kill();
      reject(error);
    };
    const append = (current: string, chunk: Buffer, stream: 'stdout' | 'stderr'): string => {
      outputBytes += chunk.byteLength;
      if (stream === 'stdout') stdoutBytes += chunk.byteLength;
      else stderrBytes += chunk.byteLength;
      if (outputBytes > input.maxOutputBytes) {
        emit({ type: 'output_limit', outputBytes });
        rejectOnce(new Error('Codex returned more diagnostic data than OpenScene can safely accept.'));
      }
      return current + chunk.toString('utf8');
    };
    const inspectLine = (line: string): void => {
      try {
        const event = JSON.parse(line) as Record<string, unknown>;
        if (typeof event.type !== 'string') return;
        const item = typeof event.item === 'object' && event.item !== null
          ? event.item as Record<string, unknown>
          : undefined;
        emit({
          type: 'codex_event',
          eventType: event.type,
          ...(typeof item?.type === 'string' ? { itemType: item.type } : {})
        });
      } catch {
        // Never print unknown output: it can contain generated screenplay text.
      }
    };
    const timer = setTimeout(() => {
      emit({ type: 'timeout', elapsedMs: Date.now() - startedAt });
      rejectOnce(new Error(`AgentRouter Writer did not finish within ${Math.round(input.timeoutMs / 1000)}s.`));
    }, input.timeoutMs);
    const heartbeat = setInterval(() => {
      emit({ type: 'heartbeat', elapsedMs: Date.now() - startedAt, stdoutBytes, stderrBytes });
    }, AGENT_ROUTER_HEARTBEAT_MS);
    heartbeat.unref();

    child.stdout.on('data', (chunk: Buffer) => {
      stdout = append(stdout, chunk, 'stdout');
      stdoutLineBuffer += chunk.toString('utf8');
      const lines = stdoutLineBuffer.split(/\r?\n/);
      stdoutLineBuffer = lines.pop() ?? '';
      for (const line of lines) inspectLine(line);
    });
    child.stderr.on('data', (chunk: Buffer) => { stderr = append(stderr, chunk, 'stderr'); });
    child.once('error', (error) => {
      emit({ type: 'process_error', message: error.message });
      rejectOnce(error);
    });
    child.once('close', (exitCode) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearInterval(heartbeat);
      if (stdoutLineBuffer.trim()) inspectLine(stdoutLineBuffer);
      emit({ type: 'closed', exitCode, elapsedMs: Date.now() - startedAt, stdoutBytes, stderrBytes });
      resolveResult({ exitCode, stdout, stderr });
    });
    child.stdin.once('error', (error) => rejectOnce(error));
    child.stdin.end(input.stdin, 'utf8');
  });

function codexEnvironment(apiKey: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of [
    'PATH', 'Path', 'PATHEXT', 'SystemRoot', 'WINDIR', 'APPDATA', 'LOCALAPPDATA',
    'TEMP', 'TMP', 'HOME', 'USERPROFILE', 'LANG', 'LC_ALL', 'TERM', 'NO_COLOR',
    'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'SSL_CERT_FILE', 'NODE_EXTRA_CA_CERTS'
  ]) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  return { ...env, AGENT_ROUTER_TOKEN: apiKey, OPENAI_API_KEY: apiKey };
}

function codexArguments(modelId: string, resultPath: string, schemaPath: string): readonly string[] {
  return [
    'exec',
    '--ignore-user-config',
    '--ignore-rules',
    '--ephemeral',
    '--skip-git-repo-check',
    '--sandbox', 'read-only',
    '--json',
    '-o', resultPath,
    '--output-schema', schemaPath,
    '-c', 'approval_policy="never"',
    '-c', `model="${modelId}"`,
    '-c', 'model_provider="agentrouter"',
    '-c', 'preferred_auth_method="apikey"',
    '-c', 'model_providers.agentrouter.name="AgentRouter"',
    '-c', `model_providers.agentrouter.base_url="${AGENT_ROUTER_BASE_URL}"`,
    '-c', 'model_providers.agentrouter.env_key="AGENT_ROUTER_TOKEN"',
    '-c', 'model_providers.agentrouter.wire_api="responses"',
    '-c', 'model_providers.agentrouter.query_params={}',
    '-c', 'model_providers.agentrouter.request_max_retries=0',
    '-c', 'model_providers.agentrouter.stream_max_retries=0',
    '-c', `model_providers.agentrouter.stream_idle_timeout_ms=${AGENT_ROUTER_STREAM_IDLE_TIMEOUT_MS}`,
    '-'
  ];
}

function compileAgentRouterWriterInput(request: WriterRequest): string {
  return [
    writerSystemPrompt(request),
    'Do not inspect files, run commands, browse, or call tools. Complete this writing task directly.',
    compileWriterPrompt(request),
    'Return exactly one JSON object and no prose. The response shape is enforced separately by the client.'
  ].join('\n\n');
}

function decodeWriterJson(raw: string): { readonly ok: true; readonly value: unknown } | { readonly ok: false } {
  const candidate = raw.trim();

  // Strategy 1: direct parse (model returned bare JSON as instructed).
  try {
    return { ok: true, value: JSON.parse(candidate) as unknown };
  } catch { /* fall through */ }

  // Strategy 2: extract content from a markdown code fence anywhere in the output.
  // The fence does not have to start at the very beginning of the string — some
  // models prepend a short acknowledgement line before the fence.
  const fenced = candidate.match(/```(?:json)?\s*\r?\n([\s\S]*?)\r?\n```/i);
  if (fenced?.[1] !== undefined) {
    try {
      return { ok: true, value: JSON.parse(fenced[1].trim()) as unknown };
    } catch { /* fall through */ }
  }

  // Strategy 3: find the first '{' and the last '}' and try to parse that
  // substring.  This recovers from models that wrap JSON in prose sentences.
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start !== -1 && end > start) {
    try {
      return { ok: true, value: JSON.parse(candidate.slice(start, end + 1)) as unknown };
    } catch { /* fall through */ }
  }

  return { ok: false };
}

function extractCodexError(stdout: string): string {
  const messages: string[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    try {
      const event = JSON.parse(line) as Record<string, unknown>;
      if (event.type === 'error' && typeof event.message === 'string') messages.push(event.message);
      if (event.type === 'turn.failed' && typeof event.error === 'object' && event.error !== null) {
        const message = (event.error as Record<string, unknown>).message;
        if (typeof message === 'string') messages.push(message);
      }
    } catch {
      // Ignore model content and unknown diagnostics.
    }
  }
  return messages.at(-1) ?? '';
}

function actionableCodexError(detail: string): string {
  if (!/content-blocked/i.test(detail)) return detail;
  const requestId = detail.match(/request id:\s*([A-Za-z0-9_-]+)/i)?.[1];
  return [
    'AgentRouter blocked the request before the model generated a response.',
    'Retry once; if it persists, use Gemini for this stage or revise sensitive wording in the approved material.',
    ...(requestId === undefined ? [] : [`Request ID: ${requestId}.`])
  ].join(' ');
}

function isSafeTempDirectory(path: string): boolean {
  const resolved = resolve(path);
  return dirname(resolved) === resolve(tmpdir()) && basename(resolved).startsWith(TEMP_DIRECTORY_PREFIX);
}

async function cleanupTempDirectory(
  path: string,
  runId: string,
  removeDirectory: (path: string) => Promise<void> = (target) =>
    rm(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 250 })
): Promise<void> {
  if (!isSafeTempDirectory(path)) {
    terminalLog(runId, 'error', 'cleanup.refused', { directory: basename(path) });
    return;
  }
  try {
    await removeDirectory(path);
    terminalLog(runId, 'info', 'cleanup.complete');
  } catch (error) {
    terminalLog(runId, 'warn', 'cleanup.skipped', {
      code: (error as NodeJS.ErrnoException).code ?? 'UNKNOWN',
      directory: basename(path)
    });
  }
}

function logProgress(runId: string, event: AgentRouterCodexProgressEvent): void {
  switch (event.type) {
    case 'started':
      terminalLog(runId, 'info', 'process.started', { pid: event.pid });
      break;
    case 'codex_event':
      terminalLog(runId, event.eventType === 'error' || event.eventType === 'turn.failed' ? 'warn' : 'info', 'codex.event', {
        type: event.eventType,
        itemType: event.itemType
      });
      break;
    case 'heartbeat':
      terminalLog(runId, 'info', 'process.working', {
        elapsedSeconds: Math.round(event.elapsedMs / 1000),
        stdoutBytes: event.stdoutBytes,
        stderrBytes: event.stderrBytes
      });
      break;
    case 'timeout':
      terminalLog(runId, 'error', 'process.timeout', { elapsedSeconds: Math.round(event.elapsedMs / 1000) });
      break;
    case 'output_limit':
      terminalLog(runId, 'error', 'process.output_limit', { outputBytes: event.outputBytes });
      break;
    case 'closed':
      terminalLog(runId, event.exitCode === 0 ? 'info' : 'warn', 'process.closed', {
        exitCode: event.exitCode,
        elapsedSeconds: Math.round(event.elapsedMs / 1000),
        stdoutBytes: event.stdoutBytes,
        stderrBytes: event.stderrBytes
      });
      break;
    case 'process_error':
      terminalLog(runId, 'error', 'process.error', { message: event.message });
      break;
  }
}

/** Run Writer through the AgentRouter-authorized Codex CLI client gate. */
export async function requestAgentRouterCodexWriter(input: AgentRouterCodexWriterInput): Promise<WriterDraft> {
  const request = parseWriterRequest(input.request);
  if (request === null) throw new Error('Writer request is invalid.');
  if (!isAgentRouterModelId(input.modelId)) throw new Error('AgentRouter Writer model is not allowed.');
  const apiKey = input.apiKey.trim();
  if (!apiKey) throw new Error('AgentRouter API key is required.');

  const runId = randomUUID().slice(0, 8);
  const startedAt = Date.now();
  const privateText = [request.sourceText, request.currentScreenplay ?? '', request.currentStageText ?? '', request.revisionInstructions ?? '', ...(request.approvedContext ?? []).map((entry) => entry.content)];
  let workspace: string | undefined;
  terminalLog(runId, 'info', 'request.start', {
    model: agentRouterNativeModelId(input.modelId),
    mode: request.mode,
    stage: request.stage,
    approvedStages: request.approvedContext?.length,
    targetSeconds: request.targetDurationSeconds,
    sourceCharacters: request.sourceText.length,
    screenplayCharacters: request.currentScreenplay?.length ?? 0,
    timeoutSeconds: Math.round(AGENT_ROUTER_CODEX_TIMEOUT_MS / 1000),
    transport: 'codex-cli-responses'
  });

  try {
    const executable = input.executable ?? await resolveCodexExecutable();
    terminalLog(runId, 'info', 'client.resolved', { executable: basename(executable) });
    workspace = await mkdtemp(join(tmpdir(), TEMP_DIRECTORY_PREFIX));
    const resultPath = join(workspace, RESULT_FILE_NAME);
    const schemaPath = join(workspace, SCHEMA_FILE_NAME);
    await writeFile(schemaPath, JSON.stringify(writerResponseSchema(request)), 'utf8');
    terminalLog(runId, 'info', 'workspace.created', { directory: basename(workspace) });
    const result = await (input.runCli ?? runAgentRouterCodex)({
      executable,
      args: codexArguments(agentRouterNativeModelId(input.modelId), resultPath, schemaPath),
      cwd: workspace,
      env: codexEnvironment(apiKey),
      stdin: compileAgentRouterWriterInput(request),
      timeoutMs: AGENT_ROUTER_CODEX_TIMEOUT_MS,
      maxOutputBytes: MAX_CLI_OUTPUT_BYTES,
      onProgress: (event) => logProgress(runId, event)
    });
    const codexError = extractCodexError(result.stdout);
    if (result.exitCode !== 0 || codexError) {
      const detail = actionableCodexError(safeDetail(codexError || result.stderr, apiKey, privateText));
      throw new Error(`AgentRouter Writer failed${detail ? `: ${detail}` : '.'}`);
    }
    let rawResult: string;
    try {
      rawResult = await readFile(resultPath, 'utf8');
    } catch {
      throw new Error('Codex completed without returning a Writer result.');
    }
    terminalLog(runId, 'info', 'response.complete', { resultCharacters: rawResult.length });
    const decoded = decodeWriterJson(rawResult);
    if (!decoded.ok) throw new Error('AgentRouter Writer returned invalid JSON.');
    const validation = validateWriterResponse(decoded.value, request);
    if (!validation.ok) {
      throw new Error(`AgentRouter Writer returned an invalid project draft at ${validation.issue.path}: ${validation.issue.message}`);
    }
    terminalLog(runId, 'info', 'request.complete', {
      elapsedSeconds: Math.round((Date.now() - startedAt) / 1000),
      scenes: validation.value.scenes.length,
      shots: validation.value.scenes.reduce((total, scene) => total + scene.shots.length, 0)
    });
    return validation.value;
  } catch (error) {
    const detail = safeDetail(error instanceof Error ? error.message : String(error), apiKey, privateText);
    terminalLog(runId, 'error', 'request.failed', {
      elapsedSeconds: Math.round((Date.now() - startedAt) / 1000),
      error: detail || 'AgentRouter Writer failed.'
    });
    throw new Error(detail || 'AgentRouter Writer failed.');
  } finally {
    if (workspace !== undefined) await cleanupTempDirectory(workspace, runId, input.removeTempDirectory);
  }
}
