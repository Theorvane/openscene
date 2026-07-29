import { describe, expect, it, vi } from 'vitest';

import { registerLlmPromptIpcHandler } from '../src/main/registerLlmPromptIpcHandler';
import type { LlmCompletionResponse } from '../src/main/llmAdapter';
import { IPC_CHANNELS } from '../src/shared/ipc';
import type { ApiResponse } from '../src/shared/models';

type RegisteredHandler = (payload?: unknown) => Promise<ApiResponse<LlmCompletionResponse>>;

describe('registerLlmPromptIpcHandler', () => {
  it('rejects an unsupported OpenAI authentication mode at the IPC boundary', async () => {
    // Given
    const handlers = new Map<string, RegisteredHandler>();
    const router = { executeCompletion: vi.fn() };
    registerLlmPromptIpcHandler({
      router,
      registerHandler: (channel, handler) => handlers.set(channel, handler)
    });
    const handler = handlers.get(IPC_CHANNELS.executeLlmPrompt);
    if (handler === undefined) {
      throw new Error('The LLM prompt handler was not registered.');
    }

    // When
    const response = await handler({
      modelId: 'openai/gpt-5.3-codex',
      prompt: 'Refactor this.',
      openAiAuthMode: 'oauth-token'
    });

    // Then
    expect(response).toEqual({
      ok: false,
      error: { code: 'INVALID_INPUT', message: 'The LLM prompt payload was not valid.' }
    });
    expect(router.executeCompletion).not.toHaveBeenCalled();
  });
});
