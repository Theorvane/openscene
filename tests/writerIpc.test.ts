import { describe, expect, it, vi } from 'vitest';

import { IPC_CHANNELS } from '../src/shared/ipc';
import { registerWriterIpcHandler } from '../src/main/registerWriterIpcHandler';
import type { WriterDraft, WriterRequest } from '../src/shared/writerWorkflow';

const request: WriterRequest = {
  mode: 'idea_to_script', sourceText: 'One idea', language: 'Vietnamese', audience: 'Adults', tone: 'Warm', targetDurationSeconds: 30
};
const draft = {
  title: 'Draft', screenplay: 'Scene.', characters: [],
  styleBible: { palette: [], lighting: '', cameraGrammar: '', texture: '', forbiddenChanges: [] },
  scenes: [{ title: 'One', objective: 'Start.', setting: '', timeOfDay: '', characterNames: [], continuityNotes: '', shots: [
    { durationSeconds: 5, framing: '', cameraMotion: '', action: 'Begin.', dialogue: '', audioCues: [], negativePrompt: '' }
  ] }]
} satisfies WriterDraft;

describe('Writer IPC', () => {
  it('reads the Gemini key in main and never requires it in the payload', async () => {
    let handler: ((payload?: unknown) => Promise<unknown>) | undefined;
    const generate = vi.fn(async (input: { apiKey: string }) => {
      expect(input.apiKey).toBe('stored-key');
      return draft;
    });
    registerWriterIpcHandler({
      credentialStore: { getCredentialValue: vi.fn(async () => 'stored-key') },
      registerHandler: (channel, value) => { expect(channel).toBe(IPC_CHANNELS.writerGenerate); handler = value; },
      generate: generate as never
    });
    await expect(handler?.({ modelId: 'gemini-3.1-pro-preview', request })).resolves.toEqual({ ok: true, value: draft });
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it('rejects invalid payloads and missing credentials before generation', async () => {
    let handler: ((payload?: unknown) => Promise<unknown>) | undefined;
    const generate = vi.fn();
    registerWriterIpcHandler({
      credentialStore: { getCredentialValue: vi.fn(async () => undefined) },
      registerHandler: (_channel, value) => { handler = value; },
      generate
    });
    await expect(handler?.({ modelId: 'grok-4', request })).resolves.toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    await expect(handler?.({ modelId: 'gemini-3.1-pro-preview', request })).resolves.toMatchObject({ ok: false, error: { message: expect.stringContaining('API key') } });
    expect(generate).not.toHaveBeenCalled();
  });

  it('reads the AgentRouter key for an AgentRouter Writer model', async () => {
    let handler: ((payload?: unknown) => Promise<unknown>) | undefined;
    const getCredentialValue = vi.fn(async (slot: string) => slot === 'agentRouterApiKey' ? 'router-key' : undefined);
    const generate = vi.fn(async (input: { apiKey: string; modelId: string }) => {
      expect(input).toMatchObject({ apiKey: 'router-key', modelId: 'agentrouter/claude-opus-4-8' });
      return draft;
    });
    registerWriterIpcHandler({
      credentialStore: { getCredentialValue },
      registerHandler: (_channel, value) => { handler = value; },
      generate: generate as never
    });
    await expect(handler?.({ modelId: 'agentrouter/claude-opus-4-8', request })).resolves.toEqual({ ok: true, value: draft });
    expect(getCredentialValue).toHaveBeenCalledWith('agentRouterApiKey');
  });
});
