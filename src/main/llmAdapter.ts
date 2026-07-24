import type { CredentialStore, ProviderCredentials } from './credentialStore';
import { DEFAULT_LLM_MODELS } from '../shared/llmModels';

export interface LlmCompletionRequest {
  modelId: string;
  prompt: string;
  systemPrompt?: string;
  ollamaBaseUrl?: string;
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
 * real Ollama server over HTTP; cloud models fail with an explicit, honest error until a
 * real provider HTTP client is implemented for that provider.
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
    const model = DEFAULT_LLM_MODELS.find((m) => m.id === request.modelId);
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

    return this.executeCloudCompletion(model.id, model.providerId, model.label, model.providerLabel, request);
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
    providerId: string,
    modelLabel: string,
    providerLabel: string,
    _request: LlmCompletionRequest
  ): Promise<LlmCompletionResponse> {
    let credKey: keyof ProviderCredentials | null = null;
    if (providerId === 'openai') credKey = 'openaiApiKey';
    else if (providerId === 'anthropic') credKey = 'anthropicApiKey';
    else if (providerId === 'google_gemini') credKey = 'geminiApiKey';
    else if (providerId === 'deepseek') credKey = 'deepseekApiKey';

    if (!credKey || !this.credentialStore) {
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

    return {
      ok: false,
      modelId,
      providerId,
      error: `${providerLabel} (${modelLabel}) cloud adapter is not yet implemented in the main process. Use a Local Engine model, or configure Ollama, for now.`
    };
  }
}
