/**
 * Cloud media-generation adapters for the voice/video workspaces. Every
 * adapter takes an injectable fetch, sends the API key only in headers, and
 * returns raw output bytes; callers own writing files and job state. Errors
 * never echo key material and keep provider detail short.
 */

type FetchLike = typeof fetch;

const REQUEST_TIMEOUT_MS = 60_000;
const VIDEO_POLL_INTERVAL_MS = 5_000;
const VIDEO_POLL_TIMEOUT_MS = 10 * 60_000;

export const DEFAULT_ELEVENLABS_VOICE_ID = '21m00Tcm4TlvDq8ikWAM';
export const DEFAULT_OPENAI_TTS_VOICE = 'alloy';
export const OPENAI_TTS_VOICES = ['alloy', 'ash', 'coral', 'echo', 'fable', 'nova', 'onyx', 'sage', 'shimmer'] as const;

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
  fetchImpl: FetchLike,
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

export type SpeechSynthesisInput = {
  readonly apiKey: string;
  readonly modelId: string;
  readonly voiceId: string;
  readonly script: string;
  readonly fetchImpl?: FetchLike;
};

/** ElevenLabs text-to-speech: returns MP3 bytes. */
export async function generateElevenLabsSpeech(input: SpeechSynthesisInput): Promise<Buffer> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const voiceId = input.voiceId.trim().length > 0 ? input.voiceId.trim() : DEFAULT_ELEVENLABS_VOICE_ID;
  const response = await fetchWithTimeout(fetchImpl, `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'xi-api-key': input.apiKey },
    body: JSON.stringify({ text: input.script, model_id: input.modelId })
  });
  await expectOk(response, 'ElevenLabs');
  return Buffer.from(await response.arrayBuffer());
}

/** OpenAI text-to-speech (gpt-4o-mini-tts / tts-1 / tts-1-hd): returns MP3 bytes. */
export async function generateOpenAiSpeech(input: SpeechSynthesisInput): Promise<Buffer> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const requestedVoice = input.voiceId.trim();
  const voice = (OPENAI_TTS_VOICES as readonly string[]).includes(requestedVoice) ? requestedVoice : DEFAULT_OPENAI_TTS_VOICE;
  const response = await fetchWithTimeout(fetchImpl, 'https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${input.apiKey}` },
    body: JSON.stringify({ model: input.modelId, input: input.script, voice, response_format: 'mp3' })
  });
  await expectOk(response, 'OpenAI');
  return Buffer.from(await response.arrayBuffer());
}

export type GeneratedVideo = {
  readonly bytes: Buffer;
  /** Provider-side job/operation id, surfaced for debugging and future cancel/retry. */
  readonly providerJobId: string;
};

/** Sora only accepts these clip lengths; requests snap to the nearest one. */
export const SORA_ALLOWED_SECONDS = [4, 8, 12] as const;

export function snapSoraSeconds(requested: number): number {
  return SORA_ALLOWED_SECONDS.reduce((best, candidate) =>
    Math.abs(candidate - requested) < Math.abs(best - requested) ? candidate : best
  );
}

export type VideoSynthesisInput = {
  readonly apiKey: string;
  /** Optional image-to-video seed; only Veo accepts one in this build. */
  readonly referenceImage?: { readonly mimeType: string; readonly base64: string };
  readonly modelId: string;
  readonly prompt: string;
  readonly aspectRatio: '16:9' | '9:16' | '1:1';
  readonly durationSeconds: number;
  readonly fetchImpl?: FetchLike;
  readonly pollIntervalMs?: number;
  readonly pollTimeoutMs?: number;
};

/**
 * Google Veo over the Gemini API: predictLongRunning → poll the operation →
 * download the generated MP4. The key travels in headers only.
 */
export async function generateVeoVideo(input: VideoSynthesisInput): Promise<GeneratedVideo> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const pollIntervalMs = input.pollIntervalMs ?? VIDEO_POLL_INTERVAL_MS;
  const pollTimeoutMs = input.pollTimeoutMs ?? VIDEO_POLL_TIMEOUT_MS;
  const headers = { 'Content-Type': 'application/json', 'x-goog-api-key': input.apiKey };
  const base = 'https://generativelanguage.googleapis.com/v1beta';

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
      parameters: { aspectRatio: input.aspectRatio === '1:1' ? '16:9' : input.aspectRatio }
    })
  });
  await expectOk(startResponse, 'Google Veo');
  const operation = (await startResponse.json()) as { name?: string };
  if (typeof operation.name !== 'string' || operation.name.length === 0) {
    throw new Error('Google Veo did not return an operation to poll.');
  }

  const deadline = Date.now() + pollTimeoutMs;
  for (;;) {
    if (Date.now() > deadline) {
      throw new Error(`Google Veo generation did not finish within ${Math.round(pollTimeoutMs / 60_000)} minutes.`);
    }
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
    const download = await fetchWithTimeout(fetchImpl, videoUri, { method: 'GET', headers: { 'x-goog-api-key': input.apiKey } }, REQUEST_TIMEOUT_MS * 5);
    await expectOk(download, 'Google Veo');
    return { bytes: Buffer.from(await download.arrayBuffer()), providerJobId: operation.name };
  }
}

/** OpenAI Sora over /v1/videos: create → poll → download content as MP4. */
export async function generateSoraVideo(input: VideoSynthesisInput): Promise<GeneratedVideo> {
  if (input.referenceImage !== undefined) {
    // Sora takes an input_reference only as multipart, which this adapter does
    // not send. Refuse rather than silently generating without the image.
    throw new Error('OpenAI Sora reference images are not supported in this build; use Google Veo, or remove the reference image.');
  }
  const fetchImpl = input.fetchImpl ?? fetch;
  const pollIntervalMs = input.pollIntervalMs ?? VIDEO_POLL_INTERVAL_MS;
  const pollTimeoutMs = input.pollTimeoutMs ?? VIDEO_POLL_TIMEOUT_MS;
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${input.apiKey}` };
  const size = input.aspectRatio === '9:16' ? '720x1280' : input.aspectRatio === '1:1' ? '720x720' : '1280x720';

  const startResponse = await fetchWithTimeout(fetchImpl, 'https://api.openai.com/v1/videos', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: input.modelId,
      prompt: input.prompt,
      seconds: String(snapSoraSeconds(input.durationSeconds)),
      size
    })
  });
  await expectOk(startResponse, 'OpenAI Sora');
  const created = (await startResponse.json()) as { id?: string };
  if (typeof created.id !== 'string' || created.id.length === 0) {
    throw new Error('OpenAI Sora did not return a video job id.');
  }

  const deadline = Date.now() + pollTimeoutMs;
  for (;;) {
    if (Date.now() > deadline) {
      throw new Error(`OpenAI Sora generation did not finish within ${Math.round(pollTimeoutMs / 60_000)} minutes.`);
    }
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
    const download = await fetchWithTimeout(fetchImpl, `https://api.openai.com/v1/videos/${encodeURIComponent(created.id)}/content`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${input.apiKey}` }
    }, REQUEST_TIMEOUT_MS * 5);
    await expectOk(download, 'OpenAI Sora');
    return { bytes: Buffer.from(await download.arrayBuffer()), providerJobId: created.id };
  }
}
