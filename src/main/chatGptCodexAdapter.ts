import { randomUUID } from 'node:crypto';

import { CHATGPT_CODEX_ENDPOINT_METADATA, chatGptCodexClientHeaders } from './chatGptOAuthService';
import type { LlmCompletionRequest, LlmCompletionResponse } from './llmAdapter';
import { getLlmModel, parseLlmModelKey } from '../shared/llmModels';
import { isOpenAiCodexModelKey } from '../shared/openAiAuth';

const REQUEST_TIMEOUT_MS = 120_000;

type ChatGptCodexCredentials = {
  readonly accessToken: string;
  readonly accountId: string;
};

type ChatGptCodexOAuthService = {
  readonly acquireCredentials: () => Promise<ChatGptCodexCredentials>;
};

type ChatGptCodexAdapterDependencies = {
  readonly oauthService: ChatGptCodexOAuthService;
  readonly fetchImpl?: typeof fetch;
};

type PlainRecord = Record<string, unknown>;

export class ChatGptCodexAdapter {
  private readonly oauthService: ChatGptCodexOAuthService;
  private readonly fetchImpl: typeof fetch;

  constructor(dependencies: ChatGptCodexAdapterDependencies) {
    this.oauthService = dependencies.oauthService;
    this.fetchImpl = dependencies.fetchImpl ?? fetch;
  }

  async executeCompletion(request: LlmCompletionRequest): Promise<LlmCompletionResponse> {
    const model = getLlmModel(request.modelId);
    const parsed = parseLlmModelKey(request.modelId);
    if (model === undefined || parsed === null) {
      return this.unsupported(request.modelId, 'unknown', 'The model ID is not a canonical catalog model.');
    }
    if (model.providerId !== 'openai' || parsed.providerId !== 'openai') {
      return this.unsupported(request.modelId, model.providerId, 'The selected model is not provided by OpenAI.');
    }
    if (!isOpenAiCodexModelKey(request.modelId)) {
      return this.unsupported(request.modelId, model.providerId, 'The ChatGPT backend does not serve the selected OpenAI model.');
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const credentials = await this.oauthService.acquireCredentials();
      const response = await this.fetchImpl(CHATGPT_CODEX_ENDPOINT_METADATA.responsesUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
          Authorization: `Bearer ${credentials.accessToken}`,
          [CHATGPT_CODEX_ENDPOINT_METADATA.accountIdHeader]: credentials.accountId,
          ...chatGptCodexClientHeaders(randomUUID())
        },
        signal: controller.signal,
        body: JSON.stringify({
          model: parsed.modelId,
          ...(request.systemPrompt ? { instructions: request.systemPrompt } : {}),
          input: request.prompt,
          // The ChatGPT backend answers only server-sent events and refuses
          // server-side response storage; both fields go on every call, and
          // omitting either returns a bare 400.
          stream: true,
          store: false
        })
      });
      if (!response.ok) {
        const detail = (await response.text())
          .slice(0, 300)
          .replaceAll(credentials.accessToken, '[redacted]')
          .replaceAll(credentials.accountId, '[redacted]');
        return {
          ok: false,
          modelId: request.modelId,
          providerId: 'openai',
          error: `ChatGPT Codex request failed with status ${response.status}${detail.length > 0 ? `: ${detail}` : ''}.`
        };
      }
      const completion = await readCodexEventStream(response);
      if (completion === undefined || completion.trim().length === 0) {
        return {
          ok: false,
          modelId: request.modelId,
          providerId: 'openai',
          error: `ChatGPT Codex returned an empty response for model "${request.modelId}".`
        };
      }
      return { ok: true, modelId: request.modelId, providerId: 'openai', completion };
    } catch (error: unknown) {
      const timedOut = error instanceof Error && error.name === 'AbortError';
      return {
        ok: false,
        modelId: request.modelId,
        providerId: 'openai',
        error: timedOut
          ? `ChatGPT Codex did not respond within ${REQUEST_TIMEOUT_MS / 1000}s.`
          : error instanceof Error
            ? error.message
            : 'ChatGPT Codex request failed.'
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  private unsupported(modelId: string, providerId: string, reason: string): LlmCompletionResponse {
    return {
      ok: false,
      modelId,
      providerId,
      error: `ChatGPT authentication supports only canonical OpenAI Codex-family models. ${reason}`
    };
  }
}

function isPlainRecord(value: unknown): value is PlainRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Reads the Codex responses SSE stream: text arrives as `output_text` deltas,
 * and the terminal `response.completed` event carries the full response as a
 * fallback for backends that skip deltas.
 */
async function readCodexEventStream(response: Response): Promise<string | undefined> {
  const body = response.body;
  if (body === null) return undefined;
  const decoder = new TextDecoder();
  let buffer = '';
  let delta = '';
  let completed: string | undefined;

  const consumeLine = (line: string): void => {
    if (!line.startsWith('data:')) return;
    const payload = line.slice('data:'.length).trim();
    if (payload.length === 0 || payload === '[DONE]') return;
    let event: unknown;
    try {
      event = JSON.parse(payload);
    } catch {
      return;
    }
    if (!isPlainRecord(event)) return;
    if (event['type'] === 'response.output_text.delta' && typeof event['delta'] === 'string') {
      delta += event['delta'];
      return;
    }
    if (event['type'] === 'response.completed') {
      completed = extractCompletion(event['response']);
    }
  };

  for await (const chunk of body as unknown as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(chunk, { stream: true });
    let newline = buffer.indexOf('\n');
    while (newline !== -1) {
      consumeLine(buffer.slice(0, newline).trim());
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf('\n');
    }
  }
  consumeLine(buffer.trim());
  return delta.length > 0 ? delta : completed;
}

function extractCompletion(payload: unknown): string | undefined {
  if (!isPlainRecord(payload)) return undefined;
  if (typeof payload['output_text'] === 'string' && payload['output_text'].length > 0) {
    return payload['output_text'];
  }
  const output = payload['output'];
  if (!Array.isArray(output)) return undefined;
  return output
    .filter(isPlainRecord)
    .filter((item) => item['type'] === 'message' && Array.isArray(item['content']))
    .flatMap((item) => item['content'])
    .filter(isPlainRecord)
    .filter((part) => part['type'] === 'output_text' && typeof part['text'] === 'string')
    .map((part) => part['text'])
    .join('');
}
