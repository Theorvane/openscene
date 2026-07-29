/**
 * opencode-style per-model visibility: every model is visible by default and
 * the Settings → Models switches persist only the hidden set locally. Keys are
 * `providerId:modelId` so the same model id under two providers stays distinct.
 */
export const MODEL_VISIBILITY_STORAGE_KEY = 'openvideo-model-visibility-v1';

export function modelVisibilityKey(providerId: string, modelId: string): string {
  return `${providerId}:${modelId}`;
}

export function parseHiddenModelKeys(raw: string | null | undefined): ReadonlySet<string> {
  if (!raw) return new Set();
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((entry): entry is string => typeof entry === 'string' && entry.includes(':')));
  } catch {
    return new Set();
  }
}

export function serializeHiddenModelKeys(hidden: ReadonlySet<string>): string {
  return JSON.stringify([...hidden].sort());
}

export function withModelVisibility(hidden: ReadonlySet<string>, key: string, visible: boolean): ReadonlySet<string> {
  if (visible === !hidden.has(key)) return hidden;
  const next = new Set(hidden);
  if (visible) {
    next.delete(key);
  } else {
    next.add(key);
  }
  return next;
}
