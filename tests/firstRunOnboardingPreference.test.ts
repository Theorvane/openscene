import { describe, expect, it } from 'vitest';

import {
  FIRST_RUN_ONBOARDING_SCHEMA_VERSION,
  FIRST_RUN_ONBOARDING_STORAGE_KEY,
  createFirstRunOnboardingCompletion,
  parseFirstRunOnboardingCompletion,
  resetFirstRunOnboardingCompletion
} from '../src/renderer/src/firstRunOnboardingPreference';

function createMemoryStorage(): Storage {
  const values = new Map<string, string>();

  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => Array.from(values.keys())[index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value)
  };
}

describe('first-run onboarding preference', () => {
  it('treats missing or malformed storage as incomplete and persists a versioned completion', () => {
    expect(FIRST_RUN_ONBOARDING_STORAGE_KEY).toBe('openvideo-first-run-onboarding-complete-v1');
    expect(parseFirstRunOnboardingCompletion(null)).toEqual({ completed: false });
    expect(parseFirstRunOnboardingCompletion('{')).toEqual({ completed: false });
    expect(parseFirstRunOnboardingCompletion(JSON.stringify({ schemaVersion: 0, completedAt: '2026-07-27T00:00:00.000Z' }))).toEqual({
      completed: false
    });

    const completion = createFirstRunOnboardingCompletion(new Date('2026-07-27T00:00:00.000Z'));

    expect(completion).toEqual({
      schemaVersion: FIRST_RUN_ONBOARDING_SCHEMA_VERSION,
      completedAt: '2026-07-27T00:00:00.000Z'
    });
    expect(parseFirstRunOnboardingCompletion(JSON.stringify(completion))).toEqual({ completed: true });
  });

  it('removes the versioned completion marker and reports storage failures', () => {
    const storage = createMemoryStorage();
    storage.setItem(FIRST_RUN_ONBOARDING_STORAGE_KEY, JSON.stringify(createFirstRunOnboardingCompletion(new Date('2026-07-27T00:00:00.000Z'))));

    expect(resetFirstRunOnboardingCompletion(storage)).toBe(true);
    expect(storage.getItem(FIRST_RUN_ONBOARDING_STORAGE_KEY)).toBeNull();

    const failingStorage: Storage = {
      ...createMemoryStorage(),
      removeItem: () => {
        throw new Error('blocked');
      }
    };

    expect(resetFirstRunOnboardingCompletion(failingStorage)).toBe(false);
  });
});
