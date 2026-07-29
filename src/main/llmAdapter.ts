import type { CredentialStore } from './credentialStore';
import { getLlmModel, parseLlmModelKey } from '../shared/llmModels';
import { getLlmProvider, type LlmProviderInfo } from '../shared/llmProviders';
import type { OpenAiAuthMode } from '../shared/openAiAuth';

export interface LlmCompletionRequest {
  modelId: string;
  prompt: string;
  systemPrompt?: string;
  ollamaBaseUrl?: string;
  openAiAuthMode?: OpenAiAuthMode;
}

export interface LlmCompletionResponse {
  ok: boolean;
  modelId: string;
  providerId: string;
  completion?: string;
  error?: string;
}

const DEFAULT_OLLAMA_BASE_URL = 'http://localhost:11434';
const OLLAMA_REQUEST_TIMEOUT_MS = 120_000;

type FetchLike = typeof fetch;

/**
 * Executes LLM completions for the model selected in Settings. Local models are sent to a
 * real Ollama server over HTTP; cloud models call their provider's HTTP API with the key
 * from main-process safe storage (OpenAI, Anthropic, Google Gemini, DeepSeek). Providers
 * without an implemented adapter fail with an explicit, honest error — never fake success.
 */
export class LlmExecutionAdapter {
  private credentialStore: CredentialStore | undefined;
  private readonly ollamaBaseUrl: string;
  private readonly fetchImpl: FetchLike;

  constructor(
    credentialStore?: CredentialStore | undefined,
    options?: { ollamaBaseUrl?: string; fetchImpl?: FetchLike }
  ) {
    this.credentialStore = credentialStore;
    this.ollamaBaseUrl = (options?.ollamaBaseUrl ?? DEFAULT_OLLAMA_BASE_URL).replace(/\/$/, '');
    this.fetchImpl = options?.fetchImpl ?? fetch;
  }

  public setCredentialStore(credentialStore: CredentialStore): void {
    this.credentialStore = credentialStore;
  }

  async executeCompletion(request: LlmCompletionRequest): Promise<LlmCompletionResponse> {
    const model = getLlmModel(request.modelId);
    if (!model) {
      return {
        ok: false,
        modelId: request.modelId,
        providerId: 'unknown',
        error: `Unknown LLM model ID "${request.modelId}".`
      };
    }

    if (model.providerId === 'local_ollama') {
      return this.executeOllamaCompletion(model.id, request);
    }

    const provider = getLlmProvider(model.providerId);
    if (provider === undefined || provider.kind !== 'cloud') {
      return { ok: false, modelId: model.id, providerId: model.providerId, error: `Provider ${model.providerLabel} is not available in the current build.` };
    }
    return this.executeCloudCompletion(model.id, provider, request);
  }

  private async executeOllamaCompletion(
    modelId: string,
    request: LlmCompletionRequest
  ): Promise<LlmCompletionResponse> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), OLLAMA_REQUEST_TIMEOUT_MS);
    const baseUrl = (request.ollamaBaseUrl || this.ollamaBaseUrl).replace(/\/$/, '');

    try {
      const response = await this.fetchImpl(`${baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          model: modelId,
          messages: [
            ...(request.systemPrompt ? [{ role: 'system', content: request.systemPrompt }] : []),
            { role: 'user', content: request.prompt }
          ],
          stream: false
        })
      });

      if (!response.ok) {
        const bodyText = await response.text().catch(() => '');
        let detail = bodyText;
        try {
          const parsed = JSON.parse(bodyText) as { error?: string };
          if (parsed.error) detail = parsed.error;
        } catch {
          // keep raw text
        }

        const notFound = response.status === 404 || /not found/i.test(detail);
        return {
          ok: false,
          modelId,
          providerId: 'local_ollama',
          error: notFound
            ? `Ollama model "${modelId}" is not installed. Run "ollama pull ${modelId}" and try again.`
            : `Ollama request failed with status ${response.status}${detail ? `: ${detail}` : ''}.`
        };
      }

      const data = (await response.json()) as { message?: { content?: string } };
      const completion = data.message?.content;
      if (typeof completion !== 'string' || completion.trim().length === 0) {
        return {
          ok: false,
          modelId,
          providerId: 'local_ollama',
          error: `Ollama returned an empty response for model "${modelId}".`
        };
      }

      return { ok: true, modelId, providerId: 'local_ollama', completion };
    } catch (err) {
      const aborted = err instanceof Error && err.name === 'AbortError';
      const message = aborted
        ? `Ollama did not respond within ${OLLAMA_REQUEST_TIMEOUT_MS / 1000}s.`
        : `Could not reach local Ollama engine at ${baseUrl}. Install Ollama (https://ollama.com), run "ollama serve", and pull the model with "ollama pull ${modelId}". (${err instanceof Error ? err.message : String(err)})`;
      return { ok: false, modelId, providerId: 'local_ollama', error: message };
    } finally {
      clearTimeout(timeout);
    }
  }

  private async executeCloudCompletion(
    modelId: string,
    provider: LlmProviderInfo,
    request: LlmCompletionRequest
  ): Promise<LlmCompletionResponse> {
    const providerId = provider.id;
    const providerLabel = provider.label;
    const credKey = provider.credentialKey;

    if (credKey === undefined || !this.credentialStore) {
      return {
        ok: false,
        modelId,
        providerId,
        error: `Cloud provider ${providerLabel} is not available in the current build.`
      };
    }

    const apiKey = await this.credentialStore.getCredentialValue(credKey);
    if (!apiKey || apiKey.trim().length === 0) {
      return {
        ok: false,
        modelId,
        providerId,
        error: `API key for ${providerLabel} is missing in settings. Please configure your ${providerLabel} API key.`
      };
    }

    const rawModelId = parseLlmModelKey(modelId)?.modelId ?? modelId;
    const cloudRequest = buildCloudCompletionRequest(provider, rawModelId, apiKey.trim(), request);
    if (cloudRequest === null) {
      return {
        ok: false,
        modelId,
        providerId,
        error: `Cloud provider ${providerLabel} is not available in the current build.`
      };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), CLOUD_REQUEST_TIMEOUT_MS);
    try {
      const response = await this.fetchImpl(cloudRequest.url, {
        method: 'POST',
        headers: cloudRequest.headers,
        signal: controller.signal,
        body: JSON.stringify(cloudRequest.body)
      });

      if (!response.ok) {
        const detail = await safeErrorDetail(response);
        const unauthorized = response.status === 401 || response.status === 403;
        return {
          ok: false,
          modelId,
          providerId,
          error: unauthorized
            ? `${providerLabel} rejected the stored API key (status ${response.status}). Reconnect the provider in Settings.`
            : `${providerLabel} request failed with status ${response.status}${detail ? `: ${detail}` : ''}.`
        };
      }

      const completion = cloudRequest.extractCompletion(await response.json());
      if (typeof completion !== 'string' || completion.trim().length === 0) {
        return { ok: false, modelId, providerId, error: `${providerLabel} returned an empty response for model "${modelId}".` };
      }
      return { ok: true, modelId, providerId, completion };
    } catch (err) {
      const aborted = err instanceof Error && err.name === 'AbortError';
      return {
        ok: false,
        modelId,
        providerId,
        error: aborted
          ? `${providerLabel} did not respond within ${CLOUD_REQUEST_TIMEOUT_MS / 1000}s.`
          : `Could not reach ${providerLabel}. (${err instanceof Error ? err.message : String(err)})`
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}

const CLOUD_REQUEST_TIMEOUT_MS = 120_000;
const ANTHROPIC_VERSION = '2023-06-01';
const MAX_COMPLETION_TOKENS = 4_096;

type CloudCompletionRequest = {
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly body: unknown;
  readonly extractCompletion: (payload: unknown) => string | undefined;
};

/** Error bodies can be attacker- or provider-controlled: keep a short text detail, never echo credentials. */
async function safeErrorDetail(response: Response): Promise<string> {
  const bodyText = await response.text().catch(() => '');
  try {
    const parsed = JSON.parse(bodyText) as { error?: { message?: string } | string };
    if (typeof parsed.error === 'string') return parsed.error.slice(0, 300);
    if (parsed.error && typeof parsed.error.message === 'string') return parsed.error.message.slice(0, 300);
  } catch {
    // keep raw text
  }
  return bodyText.slice(0, 300);
}

/** OpenAI codex-family models only speak the Responses API. */
function openAiResponsesRequest(baseUrl: string, modelId: string, apiKey: string, request: LlmCompletionRequest): CloudCompletionRequest {
  return {
    url: `${baseUrl}/responses`,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: {
      model: modelId,
      ...(request.systemPrompt ? { instructions: request.systemPrompt } : {}),
      input: request.prompt
    },
    extractCompletion: (payload) => {
      const parsed = payload as {
        output_text?: string;
        output?: readonly { type?: string; content?: readonly { type?: string; text?: string }[] }[];
      };
      if (typeof parsed.output_text === 'string' && parsed.output_text.length > 0) return parsed.output_text;
      return parsed.output
        ?.filter((item) => item.type === 'message')
        .flatMap((item) => item.content ?? [])
        .filter((part) => part.type === 'output_text' && typeof part.text === 'string')
        .map((part) => part.text)
        .join('');
    }
  };
}

function openAiStyleRequest(baseUrl: string, modelId: string, apiKey: string, request: LlmCompletionRequest): CloudCompletionRequest {
  return {
    url: `${baseUrl}/chat/completions`,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: {
      model: modelId,
      messages: [
        ...(request.systemPrompt ? [{ role: 'system', content: request.systemPrompt }] : []),
        { role: 'user', content: request.prompt }
      ]
    },
    extractCompletion: (payload) =>
      (payload as { choices?: readonly { message?: { content?: string } }[] }).choices?.[0]?.message?.content
  };
}

function buildCloudCompletionRequest(
  provider: LlmProviderInfo,
  modelId: string,
  apiKey: string,
  request: LlmCompletionRequest
): CloudCompletionRequest | null {
  switch (provider.adapter) {
    case 'openai-compatible': {
      if (provider.baseUrl === undefined) return null;
      const baseUrl = provider.baseUrl.replace(/\/$/, '');
      return provider.id === 'openai' && modelId.includes('codex')
        ? openAiResponsesRequest(baseUrl, modelId, apiKey, request)
        : openAiStyleRequest(baseUrl, modelId, apiKey, request);
    }
    case 'anthropic':
      return {
        // Anthropic-compatible gateways (MiniMax, Kimi, FreeModel…) expose the
        // same messages API under their own base URL.
        url: `${(provider.baseUrl ?? 'https://api.anthropic.com/v1').replace(/\/$/, '')}/messages`,
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': ANTHROPIC_VERSION
        },
        body: {
          model: modelId,
          max_tokens: MAX_COMPLETION_TOKENS,
          ...(request.systemPrompt ? { system: request.systemPrompt } : {}),
          messages: [{ role: 'user', content: request.prompt }]
        },
        extractCompletion: (payload) =>
          (payload as { content?: readonly { type?: string; text?: string }[] }).content
            ?.filter((part) => part.type === 'text' && typeof part.text === 'string')
            .map((part) => part.text)
            .join('')
      };
    case 'gemini':
      return {
        // The key travels in a header, not the query string, so it can never
        // land in request logs.
        url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelId)}:generateContent`,
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: {
          contents: [{ role: 'user', parts: [{ text: request.prompt }] }],
          ...(request.systemPrompt ? { systemInstruction: { parts: [{ text: request.systemPrompt }] } } : {})
        },
        extractCompletion: (payload) =>
          (payload as { candidates?: readonly { content?: { parts?: readonly { text?: string }[] } }[] }).candidates?.[0]?.content?.parts
            ?.map((part) => part.text ?? '')
            .join('')
      };
    default:
      return null;
  }
}
