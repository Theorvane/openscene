import { describe, expect, it } from 'vitest';

import { agentModelGroupStatus, buildAgentModelGroups } from '../src/renderer/src/agentModelPickerModel';

const LOCAL_MODEL_ID = 'qwen2.5-coder';
const CODEX_MODEL_ID = 'openai/gpt-5.3-codex-spark';
const allVisible = (): boolean => true;

describe('Edit Agent model picker groups', () => {
  it('always lists the local engine, so the picker is never empty with nothing connected', () => {
    const groups = buildAgentModelGroups({
      activeModelId: LOCAL_MODEL_ID,
      credentialStatus: {},
      chatGptConnected: false,
      isModelVisible: allVisible
    });

    expect(groups.length).toBeGreaterThan(0);
    const local = groups.find((group) => group.providerId === 'local_ollama');
    expect(local?.models.map((model) => model.id)).toContain(LOCAL_MODEL_ID);
    expect(agentModelGroupStatus(local!, { credentialStatus: {}, chatGptConnected: false })).toBe('Local');
    // Nothing else is reachable without a connection.
    expect(groups.some((group) => group.providerId === 'openai')).toBe(false);
  });

  it('adds the Codex models under OpenAI once a ChatGPT sign-in is connected', () => {
    const groups = buildAgentModelGroups({
      activeModelId: LOCAL_MODEL_ID,
      credentialStatus: {},
      chatGptConnected: true,
      isModelVisible: allVisible
    });

    const openai = groups.find((group) => group.providerId === 'openai');
    expect(openai).toBeDefined();
    expect(openai!.models.map((model) => model.id)).toContain(CODEX_MODEL_ID);
    // Only backend-served models ride the sign-in; the rest need an API key.
    expect(openai!.models.every((model) => model.id !== 'openai/gpt-5.3-codex')).toBe(true);
    expect(agentModelGroupStatus(openai!, { credentialStatus: {}, chatGptConnected: true })).toBe('ChatGPT');
  });

  it('lists the whole OpenAI catalog and reports Connected once an API key is stored', () => {
    const credentialStatus = { openaiApiKey: true };
    const groups = buildAgentModelGroups({
      activeModelId: LOCAL_MODEL_ID,
      credentialStatus,
      chatGptConnected: false,
      isModelVisible: allVisible
    });

    const openai = groups.find((group) => group.providerId === 'openai');
    expect(openai!.models.length).toBeGreaterThan(2);
    expect(agentModelGroupStatus(openai!, { credentialStatus, chatGptConnected: false })).toBe('Connected');
  });

  it('keeps the active model listed even when every model is hidden', () => {
    const groups = buildAgentModelGroups({
      activeModelId: CODEX_MODEL_ID,
      credentialStatus: {},
      chatGptConnected: false,
      isModelVisible: () => false
    });

    expect(groups).toHaveLength(1);
    expect(groups[0]?.models.map((model) => model.id)).toEqual([CODEX_MODEL_ID]);
  });
});
