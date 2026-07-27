export const FIRST_RUN_ONBOARDING_STORAGE_KEY = 'openvideo-first-run-onboarding-complete-v1';
export const FIRST_RUN_ONBOARDING_SCHEMA_VERSION = 1;

export type FirstRunOnboardingCompletion = {
  readonly schemaVersion: typeof FIRST_RUN_ONBOARDING_SCHEMA_VERSION;
  readonly completedAt: string;
};

export type FirstRunOnboardingState = { readonly completed: true } | { readonly completed: false };

function isCompletion(value: unknown): value is FirstRunOnboardingCompletion {
  if (value === null || typeof value !== 'object') return false;
  if (!('schemaVersion' in value) || !('completedAt' in value)) return false;

  return value.schemaVersion === FIRST_RUN_ONBOARDING_SCHEMA_VERSION && typeof value.completedAt === 'string';
}

export function createFirstRunOnboardingCompletion(now: Date = new Date()): FirstRunOnboardingCompletion {
  return {
    schemaVersion: FIRST_RUN_ONBOARDING_SCHEMA_VERSION,
    completedAt: now.toISOString()
  };
}

export function parseFirstRunOnboardingCompletion(raw: string | null | undefined): FirstRunOnboardingState {
  if (raw === null || raw === undefined) return { completed: false };

  try {
    return isCompletion(JSON.parse(raw)) ? { completed: true } : { completed: false };
  } catch {
    return { completed: false };
  }
}

export function readFirstRunOnboardingCompletion(storage: Storage): FirstRunOnboardingState {
  return parseFirstRunOnboardingCompletion(storage.getItem(FIRST_RUN_ONBOARDING_STORAGE_KEY));
}

export function writeFirstRunOnboardingCompletion(storage: Storage, now: Date = new Date()): boolean {
  try {
    storage.setItem(FIRST_RUN_ONBOARDING_STORAGE_KEY, JSON.stringify(createFirstRunOnboardingCompletion(now)));
    return true;
  } catch (error: unknown) {
    if (!(error instanceof Error)) {
      throw error;
    }
    return false;
  }
}

export function resetFirstRunOnboardingCompletion(storage: Storage): boolean {
  try {
    storage.removeItem(FIRST_RUN_ONBOARDING_STORAGE_KEY);
    return true;
  } catch (error: unknown) {
    if (!(error instanceof Error)) {
      throw error;
    }
    return false;
  }
}
