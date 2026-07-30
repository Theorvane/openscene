import type { ImageAspectRatio, ReferenceImageSelection } from './providerSeams';

/**
 * Image generation over each provider's HTTP surface.
 *
 * This lives in shared, not main, because nothing here is platform-specific once
 * the bytes are handled as base64 instead of a Node Buffer. The desktop wraps the
 * result to write a file; the mobile app renders it inline. Both send the same
 * request and parse the same response, which is the point of having a shared core
 * at all.
 */

const REQUEST_TIMEOUT_MS = 180_000;

export type GeneratedImageData = {
  /** Base64, not bytes: Buffer does not exist on React Native. */
  readonly base64: string;
  readonly mimeType: string;
  readonly providerJobId: string;
};

export type ImageRequestInput = {
  readonly apiKey: string;
  readonly modelId: string;
  readonly prompt: string;
  readonly aspectRatio: ImageAspectRatio;
  readonly negativePrompt?: string;
  readonly referenceImage?: ReferenceImageSelection;
  readonly fetchImpl?: typeof fetch;
  readonly baseUrl?: string;
};

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/**
 * Encodes bytes without Buffer or btoa. Node has both and Hermes has neither
 * reliably, so depending on either would make this module portable only on
 * paper.
 */
export function encodeBase64(bytes: Uint8Array): string {
  let out = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const a = bytes[index] ?? 0;
    const b = bytes[index + 1] ?? 0;
    const c = bytes[index + 2] ?? 0;
    const remaining = bytes.length - index;
    out += BASE64_ALPHABET[a >> 2];
    out += BASE64_ALPHABET[((a & 0x03) << 4) | (b >> 4)];
    out += remaining > 1 ? BASE64_ALPHABET[((b & 0x0f) << 2) | (c >> 6)] : '=';
    out += remaining > 2 ? BASE64_ALPHABET[c & 0x3f] : '=';
  }
  return out;
}

async function safeErrorDetail(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, 400);
  } catch {
    return '';
  }
}

async function expectOk(response: Response, providerLabel: string): Promise<void> {
  if (response.ok) return;
  const detail = await safeErrorDetail(response);
  throw new Error(
    `${providerLabel} returned ${response.status}${detail.length > 0 ? `: ${detail}` : ' (no body)'}`
  );
}

async function postJson(
  url: string,
  headers: Record<string, string>,
  body: unknown,
  providerLabel: string,
  fetchImpl: typeof fetch
): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    await expectOk(response, providerLabel);
    return (await response.json()) as unknown;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * OpenAI takes a pixel size from a fixed set rather than a ratio, and rejects
 * anything outside it, so the ratio is mapped onto the nearest supported size.
 */
export function openAiSizeFor(aspectRatio: ImageAspectRatio): string {
  switch (aspectRatio) {
    case '16:9':
    case '4:3':
      return '1536x1024';
    case '9:16':
    case '3:4':
      return '1024x1536';
    default:
      return '1024x1024';
  }
}

/** BytePlus buckets by short edge; the ratio picks the bucket's shape. */
export function bytePlusSizeFor(aspectRatio: ImageAspectRatio): string {
  switch (aspectRatio) {
    case '16:9':
      return '2048x1152';
    case '9:16':
      return '1152x2048';
    case '4:3':
      return '1728x1296';
    case '3:4':
      return '1296x1728';
    default:
      return '2048x2048';
  }
}

export function imageExtensionFor(mimeType: string): string {
  if (mimeType.includes('jpeg') || mimeType.includes('jpg')) return 'jpg';
  if (mimeType.includes('webp')) return 'webp';
  return 'png';
}

function decodedOrThrow(base64: string, mimeType: string, providerJobId: string): GeneratedImageData {
  if (base64.length === 0) {
    throw new Error('The provider returned an empty image payload.');
  }
  return { base64, mimeType, providerJobId };
}

/** Some providers return a URL instead of inline bytes; fetch it rather than failing. */
async function fetchImageUrl(url: string, providerLabel: string, fetchImpl: typeof fetch): Promise<GeneratedImageData> {
  const response = await fetchImpl(url);
  await expectOk(response, providerLabel);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length === 0) {
    throw new Error(`${providerLabel} returned an empty image body.`);
  }
  return {
    base64: encodeBase64(bytes),
    mimeType: response.headers.get('content-type') ?? 'image/png',
    providerJobId: url
  };
}

type OpenAiImageResponse = {
  readonly created?: number;
  readonly data?: readonly { readonly b64_json?: string; readonly url?: string }[];
};

/**
 * OpenAI Images. gpt-image-1 always answers with base64 and rejects an explicit
 * response_format; the dall-e models default to a URL and need it asked for.
 */
export async function requestOpenAiImage(input: ImageRequestInput): Promise<GeneratedImageData> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const isDallE = input.modelId.startsWith('dall-e');
  const parsed = (await postJson(
    `${input.baseUrl ?? 'https://api.openai.com'}/v1/images/generations`,
    { Authorization: `Bearer ${input.apiKey}` },
    {
      model: input.modelId,
      prompt: input.prompt,
      size: openAiSizeFor(input.aspectRatio),
      n: 1,
      ...(isDallE ? { response_format: 'b64_json' } : {})
    },
    'OpenAI Images',
    fetchImpl
  )) as OpenAiImageResponse;

  const first = parsed.data?.[0];
  if (first?.b64_json !== undefined) {
    return decodedOrThrow(first.b64_json, 'image/png', `openai-image-${parsed.created ?? 'result'}`);
  }
  if (first?.url !== undefined) {
    return fetchImageUrl(first.url, 'OpenAI Images', fetchImpl);
  }
  throw new Error('OpenAI Images returned no image data.');
}

type ImagenResponse = {
  readonly predictions?: readonly { readonly bytesBase64Encoded?: string; readonly mimeType?: string }[];
};

/**
 * Google Imagen over the Gemini API. The key goes in a header rather than the
 * query string so it cannot leak into logs or error messages that echo the URL.
 */
export async function requestImagenImage(input: ImageRequestInput): Promise<GeneratedImageData> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const parsed = (await postJson(
    `${input.baseUrl ?? 'https://generativelanguage.googleapis.com'}/v1beta/models/${input.modelId}:predict`,
    { 'x-goog-api-key': input.apiKey },
    {
      instances: [{ prompt: input.prompt }],
      parameters: {
        sampleCount: 1,
        aspectRatio: input.aspectRatio,
        ...(input.negativePrompt === undefined ? {} : { negativePrompt: input.negativePrompt })
      }
    },
    'Google Imagen',
    fetchImpl
  )) as ImagenResponse;

  const prediction = parsed.predictions?.[0];
  if (prediction?.bytesBase64Encoded === undefined) {
    throw new Error('Google Imagen returned no image data.');
  }
  return decodedOrThrow(
    prediction.bytesBase64Encoded,
    prediction.mimeType ?? 'image/png',
    `imagen-${input.modelId}`
  );
}

/**
 * BytePlus ModelArk (Seedream). The surface is OpenAI-shaped, which is why the
 * response handling is the same union of inline bytes or a URL.
 */
export async function requestBytePlusImage(input: ImageRequestInput): Promise<GeneratedImageData> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const parsed = (await postJson(
    `${input.baseUrl ?? 'https://ark.ap-southeast.bytepluses.com'}/api/v3/images/generations`,
    { Authorization: `Bearer ${input.apiKey}` },
    {
      model: input.modelId,
      prompt: input.prompt,
      size: bytePlusSizeFor(input.aspectRatio),
      response_format: 'b64_json',
      // Off by default: a watermark burned into a source image would carry
      // through every edit and export downstream.
      watermark: false,
      ...(input.referenceImage === undefined
        ? {}
        : { image: `data:${input.referenceImage.mimeType};base64,${input.referenceImage.base64}` })
    },
    'BytePlus Seedream',
    fetchImpl
  )) as OpenAiImageResponse;

  const first = parsed.data?.[0];
  if (first?.b64_json !== undefined) {
    return decodedOrThrow(first.b64_json, 'image/png', `seedream-${input.modelId}`);
  }
  if (first?.url !== undefined) {
    return fetchImageUrl(first.url, 'BytePlus Seedream', fetchImpl);
  }
  throw new Error('BytePlus Seedream returned no image data.');
}
