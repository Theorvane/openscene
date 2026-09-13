/**
 * HTTP media-generation adapters for the voice/video workspaces. Cloud keys
 * travel only in headers; the VieNeu adapter accepts only a loopback runtime.
 * Each adapter takes an injectable fetch and returns output bytes; callers own
 * writing files and job state. Errors never echo key material.
 */

import {
  requestGeminiOmniVideo,
  requestLumaVideo,
  requestRunwayVideo,
  requestSoraVideo,
  requestVeoVideo,
  snapSoraSeconds,
  SORA_ALLOWED_SECONDS,
  type VideoDownload,
  type VideoRequestInput
} from '../shared/videoGeneration';
import type { VoiceChoice } from '../shared/voiceCatalog';

export { snapSoraSeconds, SORA_ALLOWED_SECONDS };

type FetchLike = typeof fetch;

const REQUEST_TIMEOUT_MS = 60_000;
const VIENEU_REQUEST_TIMEOUT_MS = 10 * 60_000;
const MAX_LOCAL_AUDIO_BYTES = 512 * 1024 * 1024;

export const DEFAULT_VIENEU_BASE_URL = 'http://127.0.0.1:8001';

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
  readonly delivery?: import('../shared/voiceDelivery').VoiceDeliverySettings;
  readonly fetchImpl?: FetchLike;
};

/** ElevenLabs text-to-speech: returns MP3 bytes. */
export async function generateElevenLabsSpeech(input: SpeechSynthesisInput): Promise<Buffer> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const voiceId = input.voiceId.trim().length > 0 ? input.voiceId.trim() : DEFAULT_ELEVENLABS_VOICE_ID;
  const text = input.delivery?.performanceScript ?? input.script;
  const voiceSettings = input.delivery === undefined
    ? undefined
    : input.modelId === 'eleven_v3'
      ? { stability: input.delivery.stability }
      : {
          stability: input.delivery.stability,
          similarity_boost: input.delivery.similarityBoost,
          style: input.delivery.style,
          use_speaker_boost: input.delivery.speakerBoost,
          speed: input.delivery.speed
        };
  const response = await fetchWithTimeout(fetchImpl, `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'xi-api-key': input.apiKey },
    body: JSON.stringify({ text, model_id: input.modelId, ...(voiceSettings === undefined ? {} : { voice_settings: voiceSettings }) })
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
    body: JSON.stringify({ model: input.modelId, input: input.delivery?.performanceScript ?? input.script, voice, response_format: 'mp3' })
  });
  await expectOk(response, 'OpenAI');
  return Buffer.from(await response.arrayBuffer());
}

async function readResponseBytes(response: Response, maximumBytes: number, tooLargeMessage: string): Promise<Buffer> {
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) throw new Error(tooLargeMessage);
  if (response.body === null) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    total += next.value.byteLength;
    if (total > maximumBytes) {
      await reader.cancel().catch(() => undefined);
      throw new Error(tooLargeMessage);
    }
    chunks.push(Buffer.from(next.value));
  }
  return Buffer.concat(chunks, total);
}

function vieNeuConnectionError(error: unknown, timeoutDescription = '10 minutes'): Error {
  if (error instanceof Error && error.name === 'AbortError') {
    return new Error(`VieNeu-TTS did not respond within ${timeoutDescription}. Check the local server terminal before retrying.`);
  }
  const detail = error instanceof Error ? error.message : 'Connection failed.';
  return new Error(
    `Could not reach the local VieNeu-TTS server. Check [OpenScene][VieNeu Runtime] terminal logs or run "npm run setup:local-ai", then retry. ${detail}`
  );
}

/**
 * Only a loopback runtime is accepted. This keeps the main-process adapter
 * from becoming an arbitrary HTTP relay if an environment value is malformed.
 */
export function resolveVieNeuBaseUrl(configured = process.env.OPENSCENE_VIENEU_BASE_URL): string {
  const raw = configured?.trim() || DEFAULT_VIENEU_BASE_URL;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('OPENSCENE_VIENEU_BASE_URL must be a valid loopback HTTP URL.');
  }
  const loopbackHosts = new Set(['localhost', '127.0.0.1', '[::1]']);
  if (
    url.protocol !== 'http:' ||
    !loopbackHosts.has(url.hostname.toLowerCase()) ||
    url.username.length > 0 ||
    url.password.length > 0 ||
    url.search.length > 0 ||
    url.hash.length > 0 ||
    (url.pathname !== '/' && url.pathname !== '')
  ) {
    throw new Error('OPENSCENE_VIENEU_BASE_URL must point to an HTTP server on localhost or 127.0.0.1.');
  }
  return url.origin;
}

/** Reads the preset catalog from the running VieNeu v3 Turbo server. */
export async function listVieNeuVoices(input: {
  readonly baseUrl?: string;
  readonly fetchImpl?: FetchLike;
} = {}): Promise<readonly VoiceChoice[]> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const baseUrl = resolveVieNeuBaseUrl(input.baseUrl);
  let response: Response;
  try {
    response = await fetchWithTimeout(fetchImpl, `${baseUrl}/voices`, { method: 'GET' }, 10_000);
  } catch (error) {
    throw vieNeuConnectionError(error, '10 seconds');
  }
  if (!response.ok) {
    const detail = await safeErrorDetail(response);
    throw new Error(`VieNeu-TTS voice catalog failed with status ${response.status}${detail ? `: ${detail}` : ''}.`);
  }
  const payload: unknown = await response.json().catch(() => null);
  if (!Array.isArray(payload)) throw new Error('VieNeu-TTS returned an invalid voice catalog.');
  const seen = new Set<string>();
  const voices = payload.flatMap((candidate): VoiceChoice[] => {
    const value = candidate as { id?: unknown; name?: unknown };
    if (typeof value.id !== 'string' || value.id.trim().length === 0 || typeof value.name !== 'string') return [];
    const id = value.id.trim();
    if (seen.has(id)) return [];
    seen.add(id);
    return [{ id, label: value.name.trim() || id, description: 'VieNeu v3 Turbo preset' }];
  });
  if (voices.length === 0) throw new Error('VieNeu-TTS reported no usable preset voices.');
  return voices;
}

/**
 * The official streaming demo writes an intentionally oversized WAV data
 * length so playback can begin before synthesis ends. Once downloaded, patch
 * those two lengths to the actual byte count so editors read the duration.
 */
export function repairStreamingWavHeader(bytes: Buffer): Buffer {
  if (bytes.length < 44 || bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('VieNeu-TTS returned audio that is not a WAV file.');
  }
  const repaired = Buffer.from(bytes);
  let offset = 12;
  let dataChunkOffset = -1;
  while (offset + 8 <= repaired.length) {
    const chunkId = repaired.toString('ascii', offset, offset + 4);
    if (chunkId === 'data') {
      dataChunkOffset = offset;
      break;
    }
    const chunkLength = repaired.readUInt32LE(offset + 4);
    const next = offset + 8 + chunkLength + (chunkLength % 2);
    if (!Number.isSafeInteger(next) || next <= offset || next > repaired.length) break;
    offset = next;
  }
  if (dataChunkOffset < 0) throw new Error('VieNeu-TTS WAV response has no data chunk.');
  const audioByteLength = repaired.length - (dataChunkOffset + 8);
  repaired.writeUInt32LE(repaired.length - 8, 4);
  repaired.writeUInt32LE(audioByteLength, dataChunkOffset + 4);
  return repaired;
}

export async function generateVieNeuSpeech(input: {
  readonly voiceId: string;
  readonly script: string;
  readonly delivery?: import('../shared/voiceDelivery').VoiceDeliverySettings;
  readonly baseUrl?: string;
  readonly fetchImpl?: FetchLike;
}): Promise<Buffer> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const baseUrl = resolveVieNeuBaseUrl(input.baseUrl);
  const text = input.delivery?.performanceScript ?? input.script;
  const body = input.voiceId.trim().length > 0
    ? { text, voice_id: input.voiceId.trim() }
    : { text };
  let response: Response;
  try {
    response = await fetchWithTimeout(fetchImpl, `${baseUrl}/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }, VIENEU_REQUEST_TIMEOUT_MS);
  } catch (error) {
    throw vieNeuConnectionError(error);
  }
  if (!response.ok) {
    const detail = await safeErrorDetail(response);
    throw new Error(`VieNeu-TTS synthesis failed with status ${response.status}${detail ? `: ${detail}` : ''}.`);
  }
  const bytes = await readResponseBytes(response, MAX_LOCAL_AUDIO_BYTES, 'VieNeu-TTS audio exceeded the 512 MB safety limit.');
  return repairStreamingWavHeader(bytes);
}

export type GeneratedVideo = {
  readonly bytes: Buffer;
  /** Provider-side job/operation id, surfaced for debugging and future cancel/retry. */
  readonly providerJobId: string;
};

export type VideoSynthesisInput = VideoRequestInput;

/**
 * Downloads what the shared adapter resolved.
 *
 * The request, the polling and the failure messages are shared with the mobile
 * app; only this last step differs, because the desktop wants bytes it can write
 * to the AI directory and the phone wants the native downloader to stream
 * straight to disk.
 */
async function download(ready: VideoDownload, providerLabel: string, fetchImpl: FetchLike): Promise<GeneratedVideo> {
  const response = await fetchWithTimeout(fetchImpl, ready.url, { method: 'GET', headers: ready.headers }, REQUEST_TIMEOUT_MS * 5);
  await expectOk(response, providerLabel);
  return { bytes: Buffer.from(await response.arrayBuffer()), providerJobId: ready.providerJobId };
}

export async function generateVeoVideo(input: VideoSynthesisInput): Promise<GeneratedVideo> {
  return download(await requestVeoVideo(input), 'Google Veo', input.fetchImpl ?? fetch);
}

export async function generateGeminiOmniVideo(input: VideoSynthesisInput): Promise<GeneratedVideo> {
  return download(await requestGeminiOmniVideo(input), 'Google Gemini Omni', input.fetchImpl ?? fetch);
}

export async function generateSoraVideo(input: VideoSynthesisInput): Promise<GeneratedVideo> {
  return download(await requestSoraVideo(input), 'OpenAI Sora', input.fetchImpl ?? fetch);
}

export async function generateRunwayVideo(input: VideoSynthesisInput): Promise<GeneratedVideo> {
  return download(await requestRunwayVideo(input), 'Runway', input.fetchImpl ?? fetch);
}

export async function generateLumaVideo(input: VideoSynthesisInput): Promise<GeneratedVideo> {
  return download(await requestLumaVideo(input), 'Luma', input.fetchImpl ?? fetch);
}
