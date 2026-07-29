import { IPC_CHANNELS } from '../shared/ipc';
import type { ApiResponse } from '../shared/models';
import { isOpenAiAuthMode } from '../shared/openAiAuth';
import type { LlmCompletionRequest, LlmCompletionResponse } from './llmAdapter';
import { fail, ok } from './ipcResponses';

type LlmPromptRouter = {
  readonly executeCompletion: (request: LlmCompletionRequest) => Promise<LlmCompletionResponse>;
};

type LlmPromptIpcHandler = (payload?: unknown) => Promise<ApiResponse<LlmCompletionResponse>>;

type LlmPromptIpcDependencies = {
  readonly router: LlmPromptRouter;
  readonly registerHandler: (channel: string, handler: LlmPromptIpcHandler) => void;
};

type PlainRecord = Record<string, unknown>;

export function registerLlmPromptIpcHandler(dependencies: LlmPromptIpcDependencies): void {
  dependencies.registerHandler(IPC_CHANNELS.executeLlmPrompt, async (payload) => {
    const request = parseLlmCompletionRequest(payload);
    if (request === null) {
      return fail('INVALID_INPUT', 'The LLM prompt payload was not valid.');
    }
    try {
      return ok(await dependencies.router.executeCompletion(request));
    } catch (error: unknown) {
      return fail('UNKNOWN_ERROR', error instanceof Error ? error.message : 'Failed to execute LLM prompt');
    }
  });
}

function parseLlmCompletionRequest(payload: unknown): LlmCompletionRequest | null {
  if (!isPlainRecord(payload)) return null;
  const modelId = payload['modelId'];
  const prompt = payload['prompt'];
  const systemPrompt = payload['systemPrompt'];
  const ollamaBaseUrl = payload['ollamaBaseUrl'];
  const openAiAuthMode = payload['openAiAuthMode'];
  if (typeof modelId !== 'string' || modelId.trim().length === 0) return null;
  if (typeof prompt !== 'string' || prompt.trim().length === 0) return null;
  if (systemPrompt !== undefined && typeof systemPrompt !== 'string') return null;
  if (ollamaBaseUrl !== undefined && typeof ollamaBaseUrl !== 'string') return null;
  if (openAiAuthMode !== undefined && !isOpenAiAuthMode(openAiAuthMode)) return null;
  return {
    modelId,
    prompt,
    ...(systemPrompt === undefined ? {} : { systemPrompt }),
    ...(ollamaBaseUrl === undefined ? {} : { ollamaBaseUrl }),
    ...(openAiAuthMode === undefined ? {} : { openAiAuthMode })
  };
}

function isPlainRecord(value: unknown): value is PlainRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
