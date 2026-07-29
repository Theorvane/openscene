import type { ReasoningEffort } from '../../shared/openAiAuth';

/**
 * Per-model "variant" storage: the chosen reasoning effort is kept
 * per model key, and an absent entry means the provider default.
 */
export const REASONING_EFFORT_STORAGE_KEY = 'openvideo-reasoning-effort-v1';

export function parseReasoningEfforts(raw: string | null | undefined): Readonly<Record<string, ReasoningEffort>> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
    const entries = Object.entries(parsed as Record<string, unknown>).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1].length > 0
    );
    return Object.fromEntries(entries);
  } catch {
    return {};
  }
}

export function serializeReasoningEfforts(efforts: Readonly<Record<string, ReasoningEffort>>): string {
  return JSON.stringify(efforts);
}

/** Setting the effort to undefined clears it back to the provider default. */
export function withReasoningEffort(
  efforts: Readonly<Record<string, ReasoningEffort>>,
  modelId: string,
  effort: ReasoningEffort | undefined
): Readonly<Record<string, ReasoningEffort>> {
  if (effort === undefined) {
    if (efforts[modelId] === undefined) return efforts;
    const next = { ...efforts };
    delete next[modelId];
    return next;
  }
  if (efforts[modelId] === effort) return efforts;
  return { ...efforts, [modelId]: effort };
}

/**
 * Resolve the effort actually sent for a model: the stored choice when the
 * model still lists it, otherwise the provider default.
 */
export function resolveReasoningEffort(
  efforts: Readonly<Record<string, ReasoningEffort>>,
  model: { readonly id: string; readonly efforts?: readonly string[] | undefined }
): ReasoningEffort | undefined {
  const stored = efforts[model.id];
  if (stored === undefined) return undefined;
  return model.efforts?.includes(stored) === true ? stored : undefined;
}
