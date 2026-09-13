import { createWriteStream } from 'node:fs';
import { constants } from 'node:fs';
import { access, readFile, rename, rm } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import {
  compileComfyUiMotionWorkflow,
  inspectComfyUiMotionWorkflow,
  parseComfyUiApiWorkflow,
  type ComfyUiApiWorkflow,
  type ComfyUiMotionWorkerStatus,
  type MotionControlMode
} from '../shared/comfyUiMotion';
import type { ReferenceImageSelection } from '../shared/providerSeams';
import type { OpenedAssetPlaybackSource } from './assetLibraryStore';

const REQUEST_TIMEOUT_MS = 30_000;
const GENERATION_TIMEOUT_MS = 30 * 60_000;
const POLL_INTERVAL_MS = 2_000;
const MAX_WORKFLOW_BYTES = 5 * 1024 * 1024;
const MAX_DRIVING_VIDEO_BYTES = 256 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 1024 * 1024 * 1024;
// A safety floor, not a performance promise. Wan Animate 14B deployments vary
// with quantization/offload, but a 4 GB card cannot hold a credible workflow.
const MIN_WAN_TOTAL_VRAM_MB = 8 * 1024;

export type ComfyUiMotionConfiguration = {
  readonly baseUrl: URL;
  readonly safeEndpoint: string;
  readonly apiKey?: string;
  readonly workflowPaths: Readonly<Partial<Record<MotionControlMode, string>>>;
};

export type ComfyUiMotionProgress = 'checking' | 'uploading' | 'submitting' | 'generating' | 'downloading';

export type ComfyUiMotionGenerationInput = {
  readonly mode: MotionControlMode;
  readonly prompt: string;
  readonly characterImage: ReferenceImageSelection;
  readonly drivingVideo: OpenedAssetPlaybackSource & { readonly durationMs?: number };
  readonly outputFilePath: string;
  readonly fetchImpl?: typeof fetch;
  readonly pollIntervalMs?: number;
  readonly timeoutMs?: number;
  readonly environment?: Readonly<Record<string, string | undefined>>;
  readonly onProgress?: (stage: ComfyUiMotionProgress, elapsedMs: number) => void;
};

function configuredEndpoint(raw: string | undefined): URL {
  const value = raw?.trim() || 'http://127.0.0.1:8188';
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('OPENSCENE_COMFYUI_BASE_URL must be a valid URL.');
  }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    throw new Error('ComfyUI requires HTTPS unless the worker is on this computer.');
  }
  if (url.username || url.password || url.search || url.hash || !['', '/'].includes(url.pathname)) {
    throw new Error('ComfyUI URL must contain only scheme, host, and port.');
  }
  url.pathname = '/';
  return url;
}

export function resolveComfyUiMotionConfiguration(
  environment: Readonly<Record<string, string | undefined>> = process.env
): ComfyUiMotionConfiguration {
  const baseUrl = configuredEndpoint(environment.OPENSCENE_COMFYUI_BASE_URL);
  const move = environment.OPENSCENE_COMFYUI_WAN_MOVE_WORKFLOW_PATH?.trim();
  const mix = environment.OPENSCENE_COMFYUI_WAN_MIX_WORKFLOW_PATH?.trim();
  return {
    baseUrl,
    safeEndpoint: baseUrl.origin,
    ...(environment.OPENSCENE_COMFYUI_API_KEY?.trim() ? { apiKey: environment.OPENSCENE_COMFYUI_API_KEY.trim() } : {}),
    workflowPaths: {
      ...(move ? { move } : {}),
      ...(mix ? { mix } : {})
    }
  };
}

function headers(config: ComfyUiMotionConfiguration): Record<string, string> {
  return config.apiKey === undefined ? {} : { Authorization: `Bearer ${config.apiKey}` };
}

async function fetchBounded(
  fetchImpl: typeof fetch,
  config: ComfyUiMotionConfiguration,
  path: string,
  init: RequestInit = {},
  timeoutMs = REQUEST_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(new URL(path, config.baseUrl), {
      ...init,
      headers: { ...headers(config), ...init.headers },
      redirect: 'error',
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function responseError(response: Response): Promise<string> {
  const text = await response.text().catch(() => '');
  return text.replace(/\s+/g, ' ').trim().slice(0, 300);
}

async function expectOk(response: Response, action: string): Promise<void> {
  if (response.ok) return;
  const detail = await responseError(response);
  throw new Error(`ComfyUI ${action} failed with status ${response.status}${detail ? `: ${detail}` : ''}.`);
}

async function loadWorkflow(path: string | undefined): Promise<ComfyUiApiWorkflow> {
  if (!path) throw new Error('No API-format workflow is configured for this Motion Control mode.');
  if (!isAbsolute(path)) throw new Error('ComfyUI workflow paths must be absolute.');
  await access(path, constants.R_OK);
  const bytes = await readFile(path);
  if (bytes.byteLength > MAX_WORKFLOW_BYTES) throw new Error('ComfyUI workflow JSON must be 5 MB or smaller.');
  try {
    return parseComfyUiApiWorkflow(JSON.parse(bytes.toString('utf8')));
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error('The configured ComfyUI workflow is not valid JSON.');
    throw error;
  }
}

function modeFailure(configured: boolean, reason: string): { configured: boolean; ready: false; reason: string } {
  return { configured, ready: false, reason };
}

export async function getComfyUiMotionWorkerStatus(input: {
  readonly environment?: Readonly<Record<string, string | undefined>>;
  readonly fetchImpl?: typeof fetch;
} = {}): Promise<ComfyUiMotionWorkerStatus> {
  let config: ComfyUiMotionConfiguration;
  try {
    config = resolveComfyUiMotionConfiguration(input.environment);
  } catch (error) {
    return {
      state: 'invalid', endpoint: 'invalid', modes: { move: modeFailure(false, 'Invalid worker configuration.'), mix: modeFailure(false, 'Invalid worker configuration.') },
      reason: error instanceof Error ? error.message : 'Invalid ComfyUI configuration.'
    };
  }
  const modeDetails = {} as Record<MotionControlMode, { workflow?: ComfyUiApiWorkflow; status: ComfyUiMotionWorkerStatus['modes'][MotionControlMode] }>;
  for (const mode of ['move', 'mix'] as const) {
    const path = config.workflowPaths[mode];
    try {
      const workflow = await loadWorkflow(path);
      inspectComfyUiMotionWorkflow(workflow);
      modeDetails[mode] = { workflow, status: { configured: true, ready: false, reason: 'Checking worker nodes…' } };
    } catch (error) {
      modeDetails[mode] = { status: modeFailure(Boolean(path), error instanceof Error ? error.message : 'Workflow is invalid.') };
    }
  }
  if (!config.workflowPaths.move && !config.workflowPaths.mix) {
    return { state: 'unconfigured', endpoint: config.safeEndpoint, modes: { move: modeDetails.move.status, mix: modeDetails.mix.status }, reason: 'Set at least one ComfyUI Wan workflow path.' };
  }

  const fetchImpl = input.fetchImpl ?? fetch;
  try {
    const [statsResponse, objectInfoResponse] = await Promise.all([
      fetchBounded(fetchImpl, config, 'system_stats'),
      fetchBounded(fetchImpl, config, 'object_info')
    ]);
    await expectOk(statsResponse, 'health check');
    await expectOk(objectInfoResponse, 'node inventory');
    const stats = await statsResponse.json() as { system?: { comfyui_version?: string }; devices?: readonly { name?: string; vram_total?: number; vram_free?: number }[] };
    const objectInfo = await objectInfoResponse.json() as Record<string, unknown>;
    const device = stats.devices?.[0];
    const totalVramMb = typeof device?.vram_total === 'number' ? Math.round(device.vram_total / 1024 / 1024) : undefined;
    const insufficientVram = totalVramMb !== undefined && totalVramMb < MIN_WAN_TOTAL_VRAM_MB;
    const modes = {} as Record<MotionControlMode, ComfyUiMotionWorkerStatus['modes'][MotionControlMode]>;
    for (const mode of ['move', 'mix'] as const) {
      const detail = modeDetails[mode];
      if (!detail.workflow) {
        modes[mode] = detail.status;
        continue;
      }
      const missing = inspectComfyUiMotionWorkflow(detail.workflow).requiredClassTypes.filter((classType) => !Object.hasOwn(objectInfo, classType));
      modes[mode] = missing.length === 0 && !insufficientVram
        ? { configured: true, ready: true }
        : insufficientVram
          ? modeFailure(true, `Wan Animate is blocked on ${totalVramMb} MB total VRAM; use a worker with at least ${MIN_WAN_TOTAL_VRAM_MB} MB.`)
        : modeFailure(true, `Worker is missing nodes: ${missing.slice(0, 8).join(', ')}${missing.length > 8 ? '…' : ''}.`);
    }
    const ready = modes.move.ready || modes.mix.ready;
    return {
      state: ready ? 'ready' : 'invalid', endpoint: config.safeEndpoint,
      ...(stats.system?.comfyui_version ? { version: stats.system.comfyui_version } : {}),
      ...(device?.name ? { deviceName: device.name } : {}),
      ...(totalVramMb === undefined ? {} : { totalVramMb }),
      ...(typeof device?.vram_free === 'number' ? { freeVramMb: Math.round(device.vram_free / 1024 / 1024) } : {}),
      modes,
      ...(ready ? {} : { reason: insufficientVram
        ? `Worker has ${totalVramMb} MB total VRAM; Wan Animate requires a larger worker.`
        : 'Configured workflows do not match the nodes installed on this worker.' })
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'ComfyUI worker is unavailable.';
    return {
      state: 'offline', endpoint: config.safeEndpoint,
      modes: {
        move: modeDetails.move.workflow ? modeFailure(true, reason) : modeDetails.move.status,
        mix: modeDetails.mix.workflow ? modeFailure(true, reason) : modeDetails.mix.status
      },
      reason
    };
  }
}

async function uploadInput(
  fetchImpl: typeof fetch,
  config: ComfyUiMotionConfiguration,
  bytes: Uint8Array,
  fileName: string,
  mimeType: string,
  subfolder: string
): Promise<string> {
  const form = new FormData();
  const uploadBytes = Uint8Array.from(bytes).buffer;
  form.append('image', new Blob([uploadBytes], { type: mimeType }), fileName);
  form.append('type', 'input');
  form.append('subfolder', subfolder);
  form.append('overwrite', 'false');
  const response = await fetchBounded(fetchImpl, config, 'upload/image', { method: 'POST', body: form }, 2 * 60_000);
  await expectOk(response, 'upload');
  const result = await response.json() as { name?: string; subfolder?: string };
  if (!result.name) throw new Error('ComfyUI accepted an upload without returning its file name.');
  return result.subfolder ? `${result.subfolder}/${result.name}` : result.name;
}

function outputFile(history: unknown, outputNodeId?: string): { filename: string; subfolder: string; type: string } | null {
  const root = history as Record<string, { outputs?: Record<string, Record<string, unknown>> }>;
  const entry = Object.values(root)[0];
  if (!entry?.outputs) return null;
  const ordered = outputNodeId && entry.outputs[outputNodeId]
    ? [entry.outputs[outputNodeId], ...Object.entries(entry.outputs).filter(([id]) => id !== outputNodeId).map(([, value]) => value)]
    : Object.values(entry.outputs);
  for (const output of ordered) {
    for (const key of ['videos', 'gifs', 'images']) {
      const files = output[key];
      if (!Array.isArray(files)) continue;
      for (const candidate of files) {
        const file = candidate as { filename?: unknown; subfolder?: unknown; type?: unknown };
        if (typeof file.filename === 'string' && file.filename.toLowerCase().endsWith('.mp4')) {
          return { filename: file.filename, subfolder: typeof file.subfolder === 'string' ? file.subfolder : '', type: typeof file.type === 'string' ? file.type : 'output' };
        }
      }
    }
  }
  return null;
}

function historyFailure(history: unknown): string | null {
  const root = history as Record<string, { status?: { status_str?: unknown; messages?: unknown } }>;
  const status = Object.values(root)[0]?.status;
  if (status?.status_str !== 'error') return null;
  if (Array.isArray(status.messages)) {
    for (const message of [...status.messages].reverse()) {
      if (!Array.isArray(message) || message[0] !== 'execution_error') continue;
      const detail = message[1] as { exception_message?: unknown; node_type?: unknown } | undefined;
      const exception = typeof detail?.exception_message === 'string' ? detail.exception_message.replace(/\s+/g, ' ').slice(0, 300) : 'unknown workflow error';
      const node = typeof detail?.node_type === 'string' ? ` in ${detail.node_type}` : '';
      return `ComfyUI workflow failed${node}: ${exception}.`;
    }
  }
  return 'ComfyUI workflow failed. Inspect the ComfyUI terminal for the failing node.';
}

function historyCompleted(history: unknown): boolean {
  const root = history as Record<string, { status?: { status_str?: unknown; completed?: unknown } }>;
  const status = Object.values(root)[0]?.status;
  return status?.status_str === 'success' || status?.completed === true;
}

async function saveBoundedResponse(response: Response, outputFilePath: string): Promise<void> {
  const length = Number(response.headers.get('content-length') ?? 0);
  if (length > MAX_OUTPUT_BYTES) throw new Error('ComfyUI output exceeds the 1 GB import limit.');
  if (!response.body) throw new Error('ComfyUI returned an empty output stream.');
  const partial = `${outputFilePath}.partial`;
  let bytes = 0;
  const limit = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      bytes += chunk.byteLength;
      callback(bytes > MAX_OUTPUT_BYTES ? new Error('ComfyUI output exceeds the 1 GB import limit.') : null, chunk);
    }
  });
  try {
    await pipeline(Readable.fromWeb(response.body as never), limit, createWriteStream(partial, { flags: 'wx' }));
    await rename(partial, outputFilePath);
  } catch (error) {
    await rm(partial, { force: true }).catch(() => undefined);
    throw error;
  }
}

export async function generateComfyUiMotionVideo(input: ComfyUiMotionGenerationInput): Promise<{ providerJobId: string; outputFilePath: string }> {
  const startedAt = Date.now();
  const progress = (stage: ComfyUiMotionProgress): void => input.onProgress?.(stage, Date.now() - startedAt);
  const config = resolveComfyUiMotionConfiguration(input.environment);
  const fetchImpl = input.fetchImpl ?? fetch;
  const timeoutMs = input.timeoutMs ?? GENERATION_TIMEOUT_MS;
  progress('checking');
  const status = await getComfyUiMotionWorkerStatus({ fetchImpl, ...(input.environment === undefined ? {} : { environment: input.environment }) });
  if (!status.modes[input.mode].ready) throw new Error(status.modes[input.mode].reason ?? status.reason ?? 'ComfyUI workflow is not ready.');
  const workflow = await loadWorkflow(config.workflowPaths[input.mode]);
  if (input.drivingVideo.byteLength <= 0 || input.drivingVideo.byteLength > MAX_DRIVING_VIDEO_BYTES) {
    throw new Error('Driving video must be between 1 byte and 256 MB. Trim or compress it before Motion Control.');
  }
  if (input.drivingVideo.durationMs === undefined || input.drivingVideo.durationMs <= 0 || input.drivingVideo.durationMs > 30_000) {
    throw new Error('Driving video must have verified project metadata and be 30 seconds or shorter. Trim it before Motion Control.');
  }
  if (!input.drivingVideo.mimeType.startsWith('video/')) throw new Error('The selected driving asset is not a video.');
  const imageBytes = Buffer.from(input.characterImage.base64, 'base64');
  let videoBytes: Buffer;
  try {
    videoBytes = await input.drivingVideo.file.readFile();
  } finally {
    await input.drivingVideo.file.close();
  }
  if (videoBytes.byteLength !== input.drivingVideo.byteLength) throw new Error('The driving video changed while it was being prepared. Re-import it before retrying.');
  const imageExtension = input.characterImage.mimeType === 'image/jpeg' ? 'jpg' : input.characterImage.mimeType === 'image/webp' ? 'webp' : 'png';
  const videoExtension = input.drivingVideo.mimeType === 'video/webm' ? 'webm' : input.drivingVideo.mimeType === 'video/quicktime' ? 'mov' : 'mp4';
  const uploadFolder = `openscene/${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  progress('uploading');
  const [characterName, drivingName] = await Promise.all([
    uploadInput(fetchImpl, config, imageBytes, `character.${imageExtension}`, input.characterImage.mimeType, uploadFolder),
    uploadInput(fetchImpl, config, videoBytes, `driving.${videoExtension}`, input.drivingVideo.mimeType, uploadFolder)
  ]);
  const compiled = compileComfyUiMotionWorkflow({ workflow, characterImageName: characterName, drivingVideoName: drivingName, prompt: input.prompt });
  progress('submitting');
  const response = await fetchBounded(fetchImpl, config, 'prompt', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: compiled.prompt, client_id: `openscene-${Date.now()}` })
  });
  await expectOk(response, 'queue submission');
  const submitted = await response.json() as { prompt_id?: string; node_errors?: Record<string, unknown> };
  if (!submitted.prompt_id) throw new Error(`ComfyUI did not queue the workflow${submitted.node_errors && Object.keys(submitted.node_errors).length ? '; inspect node errors in ComfyUI' : ''}.`);

  const deadline = startedAt + timeoutMs;
  for (;;) {
    if (Date.now() > deadline) throw new Error(`ComfyUI Motion Control did not finish within ${Math.round(timeoutMs / 60_000)} minutes.`);
    await new Promise((resolve) => setTimeout(resolve, input.pollIntervalMs ?? POLL_INTERVAL_MS));
    progress('generating');
    const historyResponse = await fetchBounded(fetchImpl, config, `history/${encodeURIComponent(submitted.prompt_id)}`);
    await expectOk(historyResponse, 'history poll');
    const history = await historyResponse.json();
    const failure = historyFailure(history);
    if (failure !== null) throw new Error(failure);
    const result = outputFile(history, compiled.summary.outputNodeId);
    if (result === null) {
      if (historyCompleted(history)) throw new Error('ComfyUI finished without an MP4 output. Configure the titled output node to save MP4.');
      continue;
    }
    progress('downloading');
    const query = new URLSearchParams({ filename: result.filename, subfolder: result.subfolder, type: result.type });
    const outputResponse = await fetchBounded(fetchImpl, config, `view?${query.toString()}`, {}, 2 * 60_000);
    await expectOk(outputResponse, 'output download');
    await saveBoundedResponse(outputResponse, input.outputFilePath);
    return { providerJobId: submitted.prompt_id, outputFilePath: input.outputFilePath };
  }
}
