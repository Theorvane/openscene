import { describe, expect, it } from 'vitest';

import {
  REASONING_EFFORT_STORAGE_KEY,
  parseReasoningEfforts,
  resolveReasoningEffort,
  serializeReasoningEfforts,
  withReasoningEffort
} from '../src/renderer/src/reasoningEffortPreferences';

const CODEX = { id: 'openai/gpt-5.3-codex', efforts: ['none', 'low', 'medium', 'high', 'xhigh'] };

describe('reasoning effort preferences', () => {
  it('stores an effort per model and round-trips it', () => {
    const stored = withReasoningEffort(withReasoningEffort({}, CODEX.id, 'high'), 'anthropic/claude-opus-5', 'max');
    const restored = parseReasoningEfforts(serializeReasoningEfforts(stored));

    expect(restored[CODEX.id]).toBe('high');
    expect(restored['anthropic/claude-opus-5']).toBe('max');
  });

  it('treats an absent entry as the provider default and clears back to it', () => {
    expect(resolveReasoningEffort({}, CODEX)).toBeUndefined();

    const set = withReasoningEffort({}, CODEX.id, 'medium');
    expect(resolveReasoningEffort(set, CODEX)).toBe('medium');
    expect(resolveReasoningEffort(withReasoningEffort(set, CODEX.id, undefined), CODEX)).toBeUndefined();
    // Clearing an already-default model keeps the same object.
    expect(withReasoningEffort({}, CODEX.id, undefined)).toEqual({});
  });

  it('ignores a stored effort the model no longer accepts', () => {
    const stored = withReasoningEffort({}, CODEX.id, 'xhigh');

    expect(resolveReasoningEffort(stored, { id: CODEX.id, efforts: ['low', 'medium', 'high'] })).toBeUndefined();
    // A model with no effort list never sends one.
    expect(resolveReasoningEffort(stored, { id: CODEX.id })).toBeUndefined();
  });

  it('degrades hostile stored values to no preference', () => {
    expect(parseReasoningEfforts(null)).toEqual({});
    expect(parseReasoningEfforts('not json')).toEqual({});
    expect(parseReasoningEfforts('["high"]')).toEqual({});
    expect(parseReasoningEfforts('{"a":1,"b":"high"}')).toEqual({ b: 'high' });
  });

  it('uses a versioned non-secret storage key', () => {
    expect(REASONING_EFFORT_STORAGE_KEY).toBe('openvideo-reasoning-effort-v1');
  });
});
