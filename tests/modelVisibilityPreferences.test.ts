import { describe, expect, it } from 'vitest';

import {
  MODEL_VISIBILITY_STORAGE_KEY,
  modelVisibilityKey,
  parseHiddenModelKeys,
  serializeHiddenModelKeys,
  withModelVisibility
} from '../src/renderer/src/modelVisibilityPreferences';

describe('model visibility preferences', () => {
  it('round-trips hidden model keys through serialization', () => {
    const hidden = withModelVisibility(
      withModelVisibility(new Set(), modelVisibilityKey('openai', 'gpt-5'), false),
      modelVisibilityKey('deepseek', 'deepseek-r1'),
      false
    );

    const restored = parseHiddenModelKeys(serializeHiddenModelKeys(hidden));

    expect(restored.has('openai:gpt-5')).toBe(true);
    expect(restored.has('deepseek:deepseek-r1')).toBe(true);
    expect(restored.size).toBe(2);
  });

  it('shows every model by default and toggles idempotently', () => {
    const empty: ReadonlySet<string> = new Set();
    expect(withModelVisibility(empty, 'openai:gpt-5', true)).toBe(empty);

    const hidden = withModelVisibility(empty, 'openai:gpt-5', false);
    expect(withModelVisibility(hidden, 'openai:gpt-5', false)).toBe(hidden);
    expect(withModelVisibility(hidden, 'openai:gpt-5', true).has('openai:gpt-5')).toBe(false);
  });

  it('degrades hostile or invalid stored values to an empty hidden set', () => {
    expect(parseHiddenModelKeys(null).size).toBe(0);
    expect(parseHiddenModelKeys('not json').size).toBe(0);
    expect(parseHiddenModelKeys('{"a":1}').size).toBe(0);
    expect(parseHiddenModelKeys('[1,2,"no-colon","openai:gpt-5"]')).toEqual(new Set(['openai:gpt-5']));
  });

  it('uses a versioned non-secret storage key', () => {
    expect(MODEL_VISIBILITY_STORAGE_KEY).toBe('openvideo-model-visibility-v1');
  });
});
