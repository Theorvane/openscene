import { describe, expect, it, vi } from 'vitest';

import { ChatGptCodexAdapter } from '../src/main/chatGptCodexAdapter';

describe('ChatGptCodexAdapter', () => {
  it('routes a canonical OpenAI Codex model to the private responses endpoint with OAuth headers', async () => {
    // Given
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      expect(String(input)).toBe('https://chatgpt.com/backend-api/codex/responses');
      const headers = new Headers(init?.headers);
      expect(headers.get('Authorization')).toBe('Bearer oauth-access-token');
      expect(headers.get('ChatGPT-Account-Id')).toBe('account-123');
      expect(JSON.parse(typeof init?.body === 'string' ? init.body : '')).toEqual({
        model: 'gpt-5.3-codex-spark',
        instructions: 'Keep it short.',
        input: 'Refactor this module.',
        // Both are mandatory: the backend answers SSE only and refuses storage.
        stream: true,
        store: false
      });
      return new Response(
        [
          'event: response.output_text.delta',
          'data: {"type":"response.output_text.delta","delta":"Refac"}',
          '',
          'data: {"type":"response.output_text.delta","delta":"tored."}',
          '',
          'data: [DONE]',
          ''
        ].join('\n'),
        { status: 200, headers: { 'Content-Type': 'text/event-stream' } }
      );
    });
    const adapter = new ChatGptCodexAdapter({
      oauthService: {
        acquireCredentials: async () => ({ accessToken: 'oauth-access-token', accountId: 'account-123' })
      },
      fetchImpl
    });

    // When
    const response = await adapter.executeCompletion({
      modelId: 'openai/gpt-5.3-codex-spark',
      prompt: 'Refactor this module.',
      systemPrompt: 'Keep it short.',
      openAiAuthMode: 'chatgpt'
    });

    // Then
    expect(response).toEqual({
      ok: true,
      modelId: 'openai/gpt-5.3-codex-spark',
      providerId: 'openai',
      completion: 'Refactored.'
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('rejects a regular OpenAI model before acquiring OAuth credentials', async () => {
    // Given
    const acquireCredentials = vi.fn(async () => ({ accessToken: 'secret', accountId: 'account-123' }));
    const fetchImpl = vi.fn<typeof fetch>();
    const adapter = new ChatGptCodexAdapter({ oauthService: { acquireCredentials }, fetchImpl });

    // When
    const response = await adapter.executeCompletion({
      modelId: 'openai/gpt-5',
      prompt: 'Write a script.',
      openAiAuthMode: 'chatgpt'
    });

    // Then
    expect(response).toMatchObject({ ok: false, providerId: 'openai' });
    expect(response.error).toContain('does not serve the selected OpenAI model');
    expect(acquireCredentials).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects a non-OpenAI model before acquiring OAuth credentials', async () => {
    // Given
    const acquireCredentials = vi.fn(async () => ({ accessToken: 'secret', accountId: 'account-123' }));
    const fetchImpl = vi.fn<typeof fetch>();
    const adapter = new ChatGptCodexAdapter({ oauthService: { acquireCredentials }, fetchImpl });

    // When
    const response = await adapter.executeCompletion({
      modelId: 'anthropic/claude-sonnet-5',
      prompt: 'Write a script.',
      openAiAuthMode: 'chatgpt'
    });

    // Then
    expect(response).toMatchObject({ ok: false, providerId: 'anthropic' });
    expect(response.error).toContain('not provided by OpenAI');
    expect(acquireCredentials).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('redacts OAuth credentials if a provider error body echoes them', async () => {
    // Given
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      new Response('Rejected oauth-access-token for account-123', { status: 400 }));
    const adapter = new ChatGptCodexAdapter({
      oauthService: {
        acquireCredentials: async () => ({ accessToken: 'oauth-access-token', accountId: 'account-123' })
      },
      fetchImpl
    });

    // When
    const response = await adapter.executeCompletion({
      modelId: 'openai/gpt-5.3-codex-spark',
      prompt: 'Refactor this.',
      openAiAuthMode: 'chatgpt'
    });

    // Then
    expect(response.ok).toBe(false);
    expect(JSON.stringify(response)).not.toContain('oauth-access-token');
    expect(JSON.stringify(response)).not.toContain('account-123');
  });
});
