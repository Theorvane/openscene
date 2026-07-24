import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (text: string) => Buffer.from(text, 'utf8'),
    decryptString: (buffer: Buffer) => buffer.toString('utf8')
  }
}));

import { CredentialStore } from '../src/main/credentialStore';
import { LlmExecutionAdapter } from '../src/main/llmAdapter';

describe('LlmExecutionAdapter (main process)', () => {
  it('sends the selected model and prompt to the local Ollama /api/chat endpoint', async () => {
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe('http://localhost:11434/api/chat');
      const body = JSON.parse(init.body as string);
      expect(body.model).toBe('qwen2.5-coder');
      expect(body.messages).toEqual([{ role: 'user', content: 'Say hello' }]);
      return new Response(JSON.stringify({ message: { role: 'assistant', content: 'Hello there!' } }), {
        status: 200
      });
    });

    const adapter = new LlmExecutionAdapter(undefined, { fetchImpl: fetchMock as unknown as typeof fetch });
    const result = await adapter.executeCompletion({ modelId: 'qwen2.5-coder', prompt: 'Say hello' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(true);
    expect(result.providerId).toBe('local_ollama');
    expect(result.completion).toBe('Hello there!');
  });

  it('includes the system prompt as a leading message when provided', async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string);
      expect(body.messages[0]).toEqual({ role: 'system', content: 'You are terse.' });
      expect(body.messages[1]).toEqual({ role: 'user', content: 'Say hello' });
      return new Response(JSON.stringify({ message: { content: 'Hi.' } }), { status: 200 });
    });

    const adapter = new LlmExecutionAdapter(undefined, { fetchImpl: fetchMock as unknown as typeof fetch });
    await adapter.executeCompletion({ modelId: 'qwen2.5-coder', prompt: 'Say hello', systemPrompt: 'You are terse.' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('returns a pull instruction when Ollama reports the model is not installed', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ error: 'model "qwen2.5-coder" not found, try pulling it first' }), { status: 404 })
    );

    const adapter = new LlmExecutionAdapter(undefined, { fetchImpl: fetchMock as unknown as typeof fetch });
    const result = await adapter.executeCompletion({ modelId: 'qwen2.5-coder', prompt: 'Hi' });

    expect(result.ok).toBe(false);
    expect(result.error).toContain('ollama pull qwen2.5-coder');
  });

  it('returns a setup instruction when the local Ollama engine is unreachable', async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error('connect ECONNREFUSED 127.0.0.1:11434');
    });

    const adapter = new LlmExecutionAdapter(undefined, { fetchImpl: fetchMock as unknown as typeof fetch });
    const result = await adapter.executeCompletion({ modelId: 'qwen2.5-coder', prompt: 'Hi' });

    expect(result.ok).toBe(false);
    expect(result.error).toContain('Could not reach local Ollama engine');
    expect(result.error).toContain('ollama.com');
  });

  it('uses a caller-supplied Ollama base URL override', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      expect(url).toBe('http://192.168.1.50:11434/api/chat');
      return new Response(JSON.stringify({ message: { content: 'ok' } }), { status: 200 });
    });

    const adapter = new LlmExecutionAdapter(undefined, { fetchImpl: fetchMock as unknown as typeof fetch });
    await adapter.executeCompletion({
      modelId: 'qwen2.5-coder',
      prompt: 'Hi',
      ollamaBaseUrl: 'http://192.168.1.50:11434'
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('fails cloud model completion when credentials are missing in CredentialStore', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'cred-test-missing-'));
    try {
      const credentialStore = new CredentialStore(tempDir);
      const adapter = new LlmExecutionAdapter(credentialStore);

      const result = await adapter.executeCompletion({ modelId: 'gpt-4o', prompt: 'Generate video script' });

      expect(result.ok).toBe(false);
      expect(result.providerId).toBe('openai');
      expect(result.error).toContain('API key for OpenAI is missing in settings');
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('reports an honest not-implemented error for cloud models even with a valid API key, never fake success', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'cred-test-present-'));
    try {
      const credentialStore = new CredentialStore(tempDir);
      await credentialStore.setCredential('openaiApiKey', 'sk-test-valid-openai-key-12345');
      const adapter = new LlmExecutionAdapter(credentialStore);

      const result = await adapter.executeCompletion({ modelId: 'gpt-4o', prompt: 'Generate video script' });

      expect(result.ok).toBe(false);
      expect(result.providerId).toBe('openai');
      expect(result.error).toContain('cloud adapter is not yet implemented');
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('returns an error for unknown model IDs without making a network call', async () => {
    const fetchMock = vi.fn();
    const adapter = new LlmExecutionAdapter(undefined, { fetchImpl: fetchMock as unknown as typeof fetch });
    const result = await adapter.executeCompletion({ modelId: 'nonexistent-model-id', prompt: 'Test prompt' });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('Unknown LLM model ID "nonexistent-model-id"');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
