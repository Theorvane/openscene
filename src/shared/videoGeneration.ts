import { supportedShotSeconds } from './videoStoryboardPlan';
import {
  VIDEO_MODEL_CAPABILITIES,
  getVideoModelCapabilities,
  validateVideoRequest,
  type VideoAspectRatio
} from './mediaCapabilityRegistry';

/**
 * Video generation over each provider's HTTP surface.
 *
 * Images could be lifted into shared by handing back base64, because an image is
 * small enough that holding it in a string costs nothing. A video is not: a
 * ten-second clip is megabytes, and base64 inflates it by a third before anything
 * has touched the disk. So the seam here is one step earlier — these functions
 * create the job, poll it, and return *where to fetch the finished video*. The
 * desktop then reads it into a Buffer and writes a file; the phone hands the URL
 * straight to the native downloader and never holds the bytes in JS at all.
 *
 * Everything up to that point — the request bodies, the polling, the failure
 * messages — is identical on both, which is why it belongs here rather than
 * being written twice.
 */

const REQUEST_TIMEOUT_MS = 60_000;
const VIDEO_POLL_INTERVAL_MS = 5_000;
const VIDEO_POLL_TIMEOUT_MS = 10 * 60_000;

/** Runway pins API behaviour to a dated version rather than a semver. */
const RUNWAY_API_VERSION = '2024-11-06';

export type { VideoAspectRatio } from './mediaCapabilityRegistry';

/** Where a finished video can be fetched, and what to send when fetching it. */
export type VideoDownload = {
  readonly url: string;
  /** The API key travels here, never in the URL. */
  readonly headers: Readonly<Record<string, string>>;
  readonly providerJobId: string;
  readonly mimeType: string;
};

/** Coarse enough to drive a label; generation takes minutes, not milliseconds. */
export type VideoProgressStage = 'submitting' | 'generating' | 'ready';

export type VideoRequestInput = {
  readonly apiKey: string;
  readonly modelId: string;
  readonly prompt: string;
  readonly aspectRatio: VideoAspectRatio;
  readonly durationSeconds: number;
  /** Optional image-to-video seed; only Veo accepts one in this build. */
  readonly referenceImage?: { readonly mimeType: string; readonly base64: string };
  readonly fetchImpl?: typeof fetch;
  readonly pollIntervalMs?: number;
  readonly pollTimeoutMs?: number;
  readonly onProgress?: (stage: VideoProgressStage, elapsedMs: number) => void;
};

export function assertImplementedVideoRequest(input: Pick<VideoRequestInput, 'modelId' | 'durationSeconds' | 'aspectRatio' | 'referenceImage'>): void {
  const operation = input.referenceImage === undefined ? 'text_to_video' : 'image_to_video';
  const validation = validateVideoRequest({
    modelId: input.modelId,
    operation,
    durationSeconds: input.durationSeconds,
    aspectRatio: input.aspectRatio,
    referenceImageCount: input.referenceImage === undefined ? 0 : 1
  });
  if (!validation.ok) throw new Error(validation.message);
}

async function safeErrorDetail(response: Response): Promise<string> {
  const bodyText = await response.text().catch(() => '');
  try {
    const parsed = JSON.parse(bodyText) as { error?: { message?: string } | string; detail?: { message?: string } | string };
    const candidate = parsed.error ?? parsed.detail;
    if (typeof candidate === 'string') return candidate.slice(0, 300);
    if (candidate && typeof candidate.message === 'string') return candidate.message.slice(0, 300);
  } catch {
    // keep raw text
  }
  return bodyText.slice(0, 300);
}

async function fetchWithTimeout(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
  timeoutMs = REQUEST_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function expectOk(response: Response, providerLabel: string): Promise<void> {
  if (response.ok) return;
  const detail = await safeErrorDetail(response);
  const unauthorized = response.status === 401 || response.status === 403;
  throw new Error(
    unauthorized
      ? `${providerLabel} rejected the stored API key (status ${response.status}). Reconnect the provider in Settings.`
      : `${providerLabel} request failed with status ${response.status}${detail ? `: ${detail}` : ''}.`
  );
}

const sleep = (ms: number): Promise<void> => new Promise((resolvePromise) => setTimeout(resolvePromise, ms));

/**
 * Sora takes a discrete set of lengths, so a request has to land on one of them.
 * The numbers come from the shared table rather than a second literal: a length
 * the table knows and the adapter does not would be silently snapped to a
 * different duration than the one the user was quoted and approved.
 */
export const SORA_ALLOWED_SECONDS: readonly number[] = supportedShotSeconds('sora-2');

export function snapSoraSeconds(requested: number): number {
  return SORA_ALLOWED_SECONDS.reduce((best, candidate) =>
    Math.abs(candidate - requested) < Math.abs(best - requested) ? candidate : best
  );
}

/**
 * Google Veo over the Gemini API: predictLongRunning → poll the operation →
 * hand back the sample's download URI. The key travels in headers only.
 */
export async function requestVeoVideo(input: VideoRequestInput): Promise<VideoDownload> {
  assertImplementedVideoRequest(input);
  const fetchImpl = input.fetchImpl ?? fetch;
  const pollIntervalMs = input.pollIntervalMs ?? VIDEO_POLL_INTERVAL_MS;
  const pollTimeoutMs = input.pollTimeoutMs ?? VIDEO_POLL_TIMEOUT_MS;
  const headers = { 'Content-Type': 'application/json', 'x-goog-api-key': input.apiKey };
  const base = 'https://generativelanguage.googleapis.com/v1beta';
  const startedAt = Date.now();
  input.onProgress?.('submitting', 0);

  const startResponse = await fetchWithTimeout(fetchImpl, `${base}/models/${encodeURIComponent(input.modelId)}:predictLongRunning`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      instances: [{
        prompt: input.prompt,
        ...(input.referenceImage === undefined
          ? {}
          : { image: { bytesBase64Encoded: input.referenceImage.base64, mimeType: input.referenceImage.mimeType } })
      }],
      parameters: { aspectRatio: input.aspectRatio, durationSeconds: input.durationSeconds }
    })
  });
  await expectOk(startResponse, 'Google Veo');
  const operation = (await startResponse.json()) as { name?: string };
  if (typeof operation.name !== 'string' || operation.name.length === 0) {
    throw new Error('Google Veo did not return an operation to poll.');
  }

  const deadline = startedAt + pollTimeoutMs;
  for (;;) {
    if (Date.now() > deadline) {
      throw new Error(`Google Veo generation did not finish within ${Math.round(pollTimeoutMs / 60_000)} minutes.`);
    }
    input.onProgress?.('generating', Date.now() - startedAt);
    await sleep(pollIntervalMs);
    const pollResponse = await fetchWithTimeout(fetchImpl, `${base}/${operation.name}`, { method: 'GET', headers });
    await expectOk(pollResponse, 'Google Veo');
    const status = (await pollResponse.json()) as {
      done?: boolean;
      error?: { message?: string };
      response?: { generateVideoResponse?: { generatedSamples?: readonly { video?: { uri?: string } }[] } };
    };
    if (status.done !== true) continue;
    if (status.error !== undefined) {
      throw new Error(`Google Veo generation failed: ${status.error.message ?? 'unknown error'}.`);
    }
    const videoUri = status.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri;
    if (typeof videoUri !== 'string' || videoUri.length === 0) {
      throw new Error('Google Veo finished without a downloadable video.');
    }
    input.onProgress?.('ready', Date.now() - startedAt);
    return {
      url: videoUri,
      headers: { 'x-goog-api-key': input.apiKey },
      providerJobId: operation.name,
      mimeType: 'video/mp4'
    };
  }
}

/** OpenAI Sora over /v1/videos: create → poll → hand back the content URL. */
export async function requestSoraVideo(input: VideoRequestInput): Promise<VideoDownload> {
  assertImplementedVideoRequest(input);
  const fetchImpl = input.fetchImpl ?? fetch;
  const pollIntervalMs = input.pollIntervalMs ?? VIDEO_POLL_INTERVAL_MS;
  const pollTimeoutMs = input.pollTimeoutMs ?? VIDEO_POLL_TIMEOUT_MS;
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${input.apiKey}` };
  const size = input.aspectRatio === '9:16' ? '720x1280' : '1280x720';
  const startedAt = Date.now();
  input.onProgress?.('submitting', 0);

  const startResponse = await fetchWithTimeout(fetchImpl, 'https://api.openai.com/v1/videos', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: input.modelId,
      prompt: input.prompt,
      seconds: String(input.durationSeconds),
      size
    })
  });
  await expectOk(startResponse, 'OpenAI Sora');
  const created = (await startResponse.json()) as { id?: string };
  if (typeof created.id !== 'string' || created.id.length === 0) {
    throw new Error('OpenAI Sora did not return a video job id.');
  }

  const deadline = startedAt + pollTimeoutMs;
  for (;;) {
    if (Date.now() > deadline) {
      throw new Error(`OpenAI Sora generation did not finish within ${Math.round(pollTimeoutMs / 60_000)} minutes.`);
    }
    input.onProgress?.('generating', Date.now() - startedAt);
    await sleep(pollIntervalMs);
    const pollResponse = await fetchWithTimeout(fetchImpl, `https://api.openai.com/v1/videos/${encodeURIComponent(created.id)}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${input.apiKey}` }
    });
    await expectOk(pollResponse, 'OpenAI Sora');
    const status = (await pollResponse.json()) as { status?: string; error?: { message?: string } };
    if (status.status === 'failed') {
      throw new Error(`OpenAI Sora generation failed: ${status.error?.message ?? 'unknown error'}.`);
    }
    if (status.status !== 'completed') continue;
    input.onProgress?.('ready', Date.now() - startedAt);
    return {
      url: `https://api.openai.com/v1/videos/${encodeURIComponent(created.id)}/content`,
      headers: { Authorization: `Bearer ${input.apiKey}` },
      providerJobId: created.id,
      mimeType: 'video/mp4'
    };
  }
}

/**
 * Runway over /v1/text_to_video: create → poll the task → hand back the output URL.
 *
 * Worth having even though Runway is one provider: it fronts Seedance, Veo 3.1,
 * HappyHorse and Gemini Omni Flash behind the same endpoint, so one adapter and
 * one key make nine models reachable instead of one.
 */
export async function requestRunwayVideo(input: VideoRequestInput): Promise<VideoDownload> {
  assertImplementedVideoRequest(input);
  const fetchImpl = input.fetchImpl ?? fetch;
  const pollIntervalMs = input.pollIntervalMs ?? VIDEO_POLL_INTERVAL_MS;
  const pollTimeoutMs = input.pollTimeoutMs ?? VIDEO_POLL_TIMEOUT_MS;
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${input.apiKey}`,
    // Runway's behaviour is pinned by date; without this header the API picks a
    // default version that can change under us.
    'X-Runway-Version': RUNWAY_API_VERSION
  };
  const ratio = input.aspectRatio === '9:16' ? '720:1280' : '1280:720';
  const startedAt = Date.now();
  input.onProgress?.('submitting', 0);

  // A reference frame changes the endpoint, not just the body: Runway keeps
  // text-to-video and image-to-video separate, and the latter is what continues
  // one shot from the end of the last.
  const seeded = input.referenceImage !== undefined;
  const endpoint = seeded
    ? 'https://api.dev.runwayml.com/v1/image_to_video'
    : 'https://api.dev.runwayml.com/v1/text_to_video';

  const startResponse = await fetchWithTimeout(fetchImpl, endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: input.modelId,
      promptText: input.prompt,
      ratio,
      duration: Math.round(input.durationSeconds),
      ...(input.referenceImage === undefined
        ? {}
        : {
            // Sent inline as a data URI rather than uploaded: it saves a round
            // trip, and a 720p JPEG is far inside the 5MB encoded limit.
            promptImage: `data:${input.referenceImage.mimeType};base64,${input.referenceImage.base64}`
          })
    })
  });
  await expectOk(startResponse, 'Runway');
  const created = (await startResponse.json()) as { id?: string };
  if (typeof created.id !== 'string' || created.id.length === 0) {
    throw new Error('Runway did not return a task id.');
  }

  const deadline = startedAt + pollTimeoutMs;
  for (;;) {
    if (Date.now() > deadline) {
      throw new Error(`Runway generation did not finish within ${Math.round(pollTimeoutMs / 60_000)} minutes.`);
    }
    input.onProgress?.('generating', Date.now() - startedAt);
    await sleep(pollIntervalMs);
    const pollResponse = await fetchWithTimeout(fetchImpl, `https://api.dev.runwayml.com/v1/tasks/${encodeURIComponent(created.id)}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${input.apiKey}`, 'X-Runway-Version': RUNWAY_API_VERSION }
    });
    await expectOk(pollResponse, 'Runway');
    const status = (await pollResponse.json()) as {
      status?: string;
      failure?: string;
      failureCode?: string;
      output?: readonly string[];
    };
    if (status.status === 'FAILED' || status.status === 'CANCELED') {
      throw new Error(`Runway generation ${status.status?.toLowerCase()}: ${status.failure ?? status.failureCode ?? 'unknown error'}.`);
    }
    if (status.status !== 'SUCCEEDED') continue;
    const url = status.output?.[0];
    if (typeof url !== 'string' || url.length === 0) {
      throw new Error('Runway finished without a downloadable video.');
    }
    input.onProgress?.('ready', Date.now() - startedAt);
    // The output URL is pre-signed and expires in a day or two, so it carries
    // its own credentials and must not be stored — only downloaded now.
    return { url, headers: {}, providerJobId: created.id, mimeType: 'video/mp4' };
  }
}

/** Luma Dream Machine: create → poll the generation → hand back assets.video. */
export async function requestLumaVideo(input: VideoRequestInput): Promise<VideoDownload> {
  assertImplementedVideoRequest(input);
  const fetchImpl = input.fetchImpl ?? fetch;
  const pollIntervalMs = input.pollIntervalMs ?? VIDEO_POLL_INTERVAL_MS;
  const pollTimeoutMs = input.pollTimeoutMs ?? VIDEO_POLL_TIMEOUT_MS;
  const headers = { 'Content-Type': 'application/json', accept: 'application/json', Authorization: `Bearer ${input.apiKey}` };
  const base = 'https://api.lumalabs.ai/dream-machine/v1';
  const startedAt = Date.now();
  input.onProgress?.('submitting', 0);

  const startResponse = await fetchWithTimeout(fetchImpl, `${base}/generations`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      prompt: input.prompt,
      model: input.modelId,
      resolution: '720p',
      // Dream Machine takes only these two lengths, as a string with a unit.
      duration: `${input.durationSeconds}s`,
      aspect_ratio: input.aspectRatio
    })
  });
  await expectOk(startResponse, 'Luma');
  const created = (await startResponse.json()) as { id?: string };
  if (typeof created.id !== 'string' || created.id.length === 0) {
    throw new Error('Luma did not return a generation id.');
  }

  const deadline = startedAt + pollTimeoutMs;
  for (;;) {
    if (Date.now() > deadline) {
      throw new Error(`Luma generation did not finish within ${Math.round(pollTimeoutMs / 60_000)} minutes.`);
    }
    input.onProgress?.('generating', Date.now() - startedAt);
    await sleep(pollIntervalMs);
    const pollResponse = await fetchWithTimeout(fetchImpl, `${base}/generations/${encodeURIComponent(created.id)}`, {
      method: 'GET',
      headers: { accept: 'application/json', Authorization: `Bearer ${input.apiKey}` }
    });
    await expectOk(pollResponse, 'Luma');
    const status = (await pollResponse.json()) as {
      state?: string;
      failure_reason?: string;
      assets?: { video?: string };
    };
    if (status.state === 'failed') {
      throw new Error(`Luma generation failed: ${status.failure_reason ?? 'unknown error'}.`);
    }
    if (status.state !== 'completed') continue;
    const url = status.assets?.video;
    if (typeof url !== 'string' || url.length === 0) {
      throw new Error('Luma finished without a downloadable video.');
    }
    input.onProgress?.('ready', Date.now() - startedAt);
    return { url, headers: {}, providerJobId: created.id, mimeType: 'video/mp4' };
  }
}

const VIDEO_ADAPTERS: Readonly<Record<string, (input: VideoRequestInput) => Promise<VideoDownload>>> = {
  openai: requestSoraVideo,
  google_gemini: requestVeoVideo,
  runway: requestRunwayVideo,
  luma: requestLumaVideo
};

/**
 * Whether a provider can start a shot from a given frame.
 *
 * Continuity is only offered where it is real: Veo takes inline bytes and
 * Runway takes a data URI, while Sora's reference input is multipart this
 * adapter does not send and Luma's needs a hosted URL. Offering it everywhere
 * and silently dropping it would produce a cut that does not match and no
 * indication why.
 */
export function supportsReferenceImage(modelOrProviderId: string): boolean {
  const exact = getVideoModelCapabilities(modelOrProviderId);
  if (exact !== undefined) return exact.implemented.includes('image_to_video');
  return VIDEO_MODEL_CAPABILITIES.some(
    (model) => model.providerId === modelOrProviderId && model.implemented.includes('image_to_video')
  );
}

/** The adapter a provider id resolves to, or undefined when none is ported. */
export function videoAdapterFor(providerId: string): ((input: VideoRequestInput) => Promise<VideoDownload>) | undefined {
  return VIDEO_ADAPTERS[providerId];
}
