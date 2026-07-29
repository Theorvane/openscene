import { describe, expect, it, vi } from 'vitest';

import { LlmPromptRouter } from '../src/main/llmPromptRouter';
import type { LlmCompletionRequest, LlmCompletionResponse } from '../src/main/llmAdapter';

const CHATGPT_RESPONSE: LlmCompletionResponse = {
  ok: true,
  modelId: 'openai/gpt-5.3-codex',
  providerId: 'openai',
  completion: 'OAuth completion'
};

const API_KEY_RESPONSE: LlmCompletionResponse = {
  ok: true,
  modelId: 'openai/gpt-5.3-codex',
  providerId: 'openai',
  completion: 'API-key completion'
};

describe('LlmPromptRouter', () => {
  it('uses the ChatGPT Codex adapter only when ChatGPT authentication is explicit', async () => {
    // Given
    const apiKeyAdapter = { executeCompletion: vi.fn() };
    const chatGptAdapter = { executeCompletion: vi.fn(async () => CHATGPT_RESPONSE) };
    const router = new LlmPromptRouter({ apiKeyAdapter, chatGptAdapter });
    const request: LlmCompletionRequest = {
      modelId: 'openai/gpt-5.3-codex',
      prompt: 'Refactor this.',
      openAiAuthMode: 'chatgpt'
    };

    // When
    const response = await router.executeCompletion(request);

    // Then
    expect(response).toEqual(CHATGPT_RESPONSE);
    expect(chatGptAdapter.executeCompletion).toHaveBeenCalledWith(request);
    expect(apiKeyAdapter.executeCompletion).not.toHaveBeenCalled();
  });

  it('keeps the API-key adapter as the default when no authentication mode is supplied', async () => {
    // Given
    const apiKeyAdapter = { executeCompletion: vi.fn(async () => API_KEY_RESPONSE) };
    const chatGptAdapter = { executeCompletion: vi.fn() };
    const router = new LlmPromptRouter({ apiKeyAdapter, chatGptAdapter });
    const request: LlmCompletionRequest = {
      modelId: 'openai/gpt-5.3-codex',
      prompt: 'Refactor this.'
    };

    // When
    const response = await router.executeCompletion(request);

    // Then
    expect(response).toEqual(API_KEY_RESPONSE);
    expect(apiKeyAdapter.executeCompletion).toHaveBeenCalledWith(request);
    expect(chatGptAdapter.executeCompletion).not.toHaveBeenCalled();
  });
});
