import { describe, expect, it, vi } from 'vitest';

import { requestAgentRouterHttpWriter } from '../src/main/agentRouterHttpWriter';
import type { WriterDraft, WriterRequest } from '../src/shared/writerWorkflow';

const request: WriterRequest = {
  mode: 'content_to_script',
  sourceText: 'A private short product brief.',
  language: 'Vietnamese',
  audience: 'Creators',
  tone: 'Clear',
  targetDurationSeconds: 30
};

const draft: WriterDraft = {
  title: 'Creator tool',
  screenplay: 'A creator opens the tool.',
  characters: [],
  styleBible: { palette: [], lighting: '', cameraGrammar: '', texture: '', forbiddenChanges: [] },
  scenes: [{
    title: 'Open',
    objective: 'Introduce the tool.',
    setting: 'Studio',
    timeOfDay: 'Day',
    characterNames: [],
    continuityNotes: '',
    shots: [{
      durationSeconds: 8,
      framing: 'Medium',
      cameraMotion: 'Static',
      action: 'The tool opens.',
      dialogue: '',
      audioCues: [],
      negativePrompt: ''
    }]
  }]
};

describe('AgentRouter HTTP Writer bridge', () => {
  it('uses the working OpenAI-compatible endpoint and both AgentRouter auth headers', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe('https://agentrouter.org/v1/chat/completions');
      const headers = init?.headers as Record<string, string>;
      expect(headers.Authorization).toBe('Bearer router-secret');
      expect(headers.apiKey).toBe('router-secret');
      const body = JSON.parse(String(init?.body)) as {
        model?: unknown;
        stream?: unknown;
        max_tokens?: unknown;
        messages?: readonly { role?: unknown; content?: unknown }[];
      };
      expect(body.model).toBe('gpt-5.6-sol');
      expect(body.stream).toBe(false);
      expect(body.max_tokens).toBe(32_768);
      expect(body.messages?.[1]?.content).toContain(request.sourceText);
      expect(body.messages?.[1]?.content).toContain('"framing":{"type":"string"}');
      expect(String(init?.body)).not.toContain('router-secret');
      return new Response(JSON.stringify({
        id: 'response-1',
        model: 'gpt-5.6-sol',
        choices: [{ message: { content: JSON.stringify(draft) } }],
        usage: { prompt_tokens: 100, completion_tokens: 200, total_tokens: 300 }
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });

    try {
      await expect(requestAgentRouterHttpWriter({
        apiKey: 'router-secret', modelId: 'agentrouter/gpt-5.6-sol', request, fetchImpl
      })).resolves.toEqual(draft);
      expect(fetchImpl).toHaveBeenCalledOnce();
      const logs = info.mock.calls.flat().join('\n');
      expect(logs).toContain('openai-compatible-http');
      expect(logs).toContain('response.complete');
      expect(logs).toContain('"totalTokens":300');
      expect(logs).not.toContain('router-secret');
      expect(logs).not.toContain(request.sourceText);
    } finally {
      info.mockRestore();
    }
  });

  it('accepts multipart content and one JSON Markdown fence', async () => {
    const fetchImpl = async () => new Response(JSON.stringify({
      choices: [{ message: { content: [{ type: 'text', text: `\`\`\`json\n${JSON.stringify(draft)}\n\`\`\`` }] } }]
    }), { status: 200 });
    await expect(requestAgentRouterHttpWriter({
      apiKey: 'router-secret', modelId: 'agentrouter/deepseek-v4-flash', request, fetchImpl
    })).resolves.toEqual(draft);
  });

  it('returns a redacted provider error without exposing input or key in terminal logs', async () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const fetchImpl = async () => new Response(JSON.stringify({
      error: { message: `Rejected router-secret for ${request.sourceText}` }
    }), { status: 401 });
    try {
      await expect(requestAgentRouterHttpWriter({
        apiKey: 'router-secret', modelId: 'agentrouter/glm-5.3', request, fetchImpl
      })).rejects.toThrow('Rejected [REDACTED] for [REDACTED_INPUT]');
      const logs = [...errorLog.mock.calls.flat(), ...warning.mock.calls.flat()].join('\n');
      expect(logs).not.toContain('router-secret');
      expect(logs).not.toContain(request.sourceText);
    } finally {
      errorLog.mockRestore();
      warning.mockRestore();
    }
  });

  it('fails closed on malformed JSON and invalid Writer contracts', async () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const response = (content: string) => async () => new Response(JSON.stringify({
        choices: [{ message: { content } }]
      }), { status: 200 });
      await expect(requestAgentRouterHttpWriter({
        apiKey: 'key', modelId: 'agentrouter/gpt-5.6-sol', request, fetchImpl: response('{')
      })).rejects.toThrow('returned invalid JSON');
      await expect(requestAgentRouterHttpWriter({
        apiKey: 'key', modelId: 'agentrouter/gpt-5.6-sol', request, fetchImpl: response('{}')
      })).rejects.toThrow('at title: must be text');
    } finally {
      errorLog.mockRestore();
    }
  });
});
