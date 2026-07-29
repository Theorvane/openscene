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

      const result = await adapter.executeCompletion({ modelId: 'openai/gpt-5', prompt: 'Generate video script' });

      expect(result.ok).toBe(false);
      expect(result.providerId).toBe('openai');
      expect(result.error).toContain('API key for OpenAI is missing in settings');
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('sends OpenAI completions to the chat completions API with a bearer key from safe storage', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'cred-test-openai-'));
    try {
      const credentialStore = new CredentialStore(tempDir);
      await credentialStore.setCredential('openaiApiKey', 'sk-test-valid-openai-key-12345');
      const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
        expect(url).toBe('https://api.openai.com/v1/chat/completions');
        expect(url).not.toContain('/v1/responses');
        expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-test-valid-openai-key-12345');
        const body = JSON.parse(init.body as string);
        expect(body.model).toBe('gpt-5');
        expect(body.messages).toEqual([
          { role: 'system', content: 'You are terse.' },
          { role: 'user', content: 'Generate video script' }
        ]);
        return new Response(JSON.stringify({ choices: [{ message: { content: 'Scene one.' } }] }), { status: 200 });
      });
      const adapter = new LlmExecutionAdapter(credentialStore, { fetchImpl: fetchMock as unknown as typeof fetch });

      const result = await adapter.executeCompletion({ modelId: 'openai/gpt-5', prompt: 'Generate video script', systemPrompt: 'You are terse.' });

      expect(result).toEqual({ ok: true, modelId: 'openai/gpt-5', providerId: 'openai', completion: 'Scene one.' });
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('sends Anthropic completions to the messages API with version header and joined text content', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'cred-test-anthropic-'));
    try {
      const credentialStore = new CredentialStore(tempDir);
      await credentialStore.setCredential('anthropicApiKey', 'sk-ant-test-key');
      const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
        expect(url).toBe('https://api.anthropic.com/v1/messages');
        const headers = init.headers as Record<string, string>;
        expect(headers['x-api-key']).toBe('sk-ant-test-key');
        expect(headers['anthropic-version']).toBe('2023-06-01');
        const body = JSON.parse(init.body as string);
        expect(body.model).toBe('claude-sonnet-5');
        expect(body.system).toBe('You are terse.');
        expect(body.messages).toEqual([{ role: 'user', content: 'Hi' }]);
        return new Response(JSON.stringify({ content: [{ type: 'text', text: 'Hello ' }, { type: 'text', text: 'there.' }] }), { status: 200 });
      });
      const adapter = new LlmExecutionAdapter(credentialStore, { fetchImpl: fetchMock as unknown as typeof fetch });

      const result = await adapter.executeCompletion({ modelId: 'anthropic/claude-sonnet-5', prompt: 'Hi', systemPrompt: 'You are terse.' });

      expect(result).toEqual({ ok: true, modelId: 'anthropic/claude-sonnet-5', providerId: 'anthropic', completion: 'Hello there.' });
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('sends Anthropic-compatible gateway completions to the gateway base URL, not api.anthropic.com', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'cred-test-minimax-'));
    try {
      const credentialStore = new CredentialStore(tempDir);
      await credentialStore.setCredential('minimax', 'mm-test-key');
      const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
        expect(url).toBe('https://api.minimax.io/anthropic/v1/messages');
        expect((init.headers as Record<string, string>)['x-api-key']).toBe('mm-test-key');
        expect(JSON.parse(init.body as string).model).toBe('MiniMax-M2');
        return new Response(JSON.stringify({ content: [{ type: 'text', text: 'ok' }] }), { status: 200 });
      });
      const adapter = new LlmExecutionAdapter(credentialStore, { fetchImpl: fetchMock as unknown as typeof fetch });

      const result = await adapter.executeCompletion({ modelId: 'minimax/MiniMax-M2', prompt: 'Hi' });

      expect(result.ok).toBe(true);
      expect(fetchMock).toHaveBeenCalledOnce();
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('sends Gemini completions with the key in a header — never in the URL — and DeepSeek over the OpenAI-compatible API', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'cred-test-gemini-'));
    try {
      const credentialStore = new CredentialStore(tempDir);
      await credentialStore.setCredential('geminiApiKey', 'AIzaSy-test');
      await credentialStore.setCredential('deepseekApiKey', 'sk-deepseek-test');
      const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
        if (url.includes('generativelanguage')) {
          expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-preview:generateContent');
          expect(url).not.toContain('AIzaSy-test');
          expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe('AIzaSy-test');
          return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'Gemini says hi.' }] } }] }), { status: 200 });
        }
        expect(url).toBe('https://api.deepseek.com/chat/completions');
        expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-deepseek-test');
        return new Response(JSON.stringify({ choices: [{ message: { content: 'DeepSeek says hi.' } }] }), { status: 200 });
      });
      const adapter = new LlmExecutionAdapter(credentialStore, { fetchImpl: fetchMock as unknown as typeof fetch });

      const gemini = await adapter.executeCompletion({ modelId: 'google_gemini/gemini-3-pro-preview', prompt: 'Hi' });
      const deepseek = await adapter.executeCompletion({ modelId: 'deepseek/deepseek-chat', prompt: 'Hi' });

      expect(gemini).toMatchObject({ ok: true, providerId: 'google_gemini', completion: 'Gemini says hi.' });
      expect(deepseek).toMatchObject({ ok: true, providerId: 'deepseek', completion: 'DeepSeek says hi.' });
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('sends codex-family OpenAI models to the Responses API and joins output text', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'cred-test-codex-'));
    try {
      const credentialStore = new CredentialStore(tempDir);
      await credentialStore.setCredential('openaiApiKey', 'sk-codex-key');
      const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
        expect(url).toBe('https://api.openai.com/v1/responses');
        expect(url).not.toContain('chatgpt.com/backend-api/codex/responses');
        expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-codex-key');
        const body = JSON.parse(init.body as string);
        expect(body.model).toBe('gpt-5.3-codex');
        expect(body.instructions).toBe('You are terse.');
        expect(body.input).toBe('Refactor this');
        return new Response(
          JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text: 'Done.' }] }] }),
          { status: 200 }
        );
      });
      const adapter = new LlmExecutionAdapter(credentialStore, { fetchImpl: fetchMock as unknown as typeof fetch });

      const result = await adapter.executeCompletion({ modelId: 'openai/gpt-5.3-codex', prompt: 'Refactor this', systemPrompt: 'You are terse.' });

      expect(result).toEqual({ ok: true, modelId: 'openai/gpt-5.3-codex', providerId: 'openai', completion: 'Done.' });
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('reports rejected keys with a reconnect hint and never echoes the key material', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'cred-test-reject-'));
    try {
      const credentialStore = new CredentialStore(tempDir);
      await credentialStore.setCredential('openaiApiKey', 'sk-secret-key-material');
      const fetchMock = vi.fn(async () =>
        new Response(JSON.stringify({ error: { message: 'Incorrect API key provided' } }), { status: 401 })
      );
      const adapter = new LlmExecutionAdapter(credentialStore, { fetchImpl: fetchMock as unknown as typeof fetch });

      const result = await adapter.executeCompletion({ modelId: 'openai/gpt-5', prompt: 'Hi' });

      expect(result.ok).toBe(false);
      expect(result.error).toContain('Reconnect the provider in Settings');
      expect(JSON.stringify(result)).not.toContain('sk-secret-key-material');
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
