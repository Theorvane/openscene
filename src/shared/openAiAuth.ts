export type OpenAiAuthMode = 'api-key' | 'chatgpt';

export function isOpenAiAuthMode(value: unknown): value is OpenAiAuthMode {
  return value === 'api-key' || value === 'chatgpt';
}

/**
 * Reasoning effort, also called a model "variant". The accepted values
 * come from the model's own catalog entry (e.g. none/low/medium/high/xhigh), and
 * `undefined` means the provider default.
 */
export type ReasoningEffort = string;

export type ChatGptOAuthStatus =
  | { readonly kind: 'connected' }
  | { readonly kind: 'disconnected' };

/**
 * Models the ChatGPT Codex backend actually serves:
 * an explicit allow list, an explicit deny list, and otherwise only OpenAI
 * models newer than gpt-5.4. Anything else is rejected by the backend with a
 * bare 400, so it must never be offered on the sign-in transport.
 */
const CHATGPT_ALLOWED_MODEL_IDS = new Set(['gpt-5.5', 'gpt-5.3-codex-spark', 'gpt-5.4', 'gpt-5.4-mini']);
// The bare `gpt-5.6` id is admitted along with its variants; the backend is
// the authority on what it will actually run.
const CHATGPT_DENIED_MODEL_IDS = new Set(['gpt-5.5-pro']);

function isChatGptServedModelId(modelId: string): boolean {
  if (CHATGPT_ALLOWED_MODEL_IDS.has(modelId)) return true;
  if (CHATGPT_DENIED_MODEL_IDS.has(modelId)) return false;
  if (modelId.endsWith('-pro')) return false;
  return isNewerThanGpt54(modelId);
}

/** Minimum served generation: anything after GPT-5.4 rides the sign-in. */
const CHATGPT_MIN_EXCLUSIVE_VERSION: readonly [number, number] = [5, 4];

/**
 * Compares the version as a [major, minor] pair rather than a float, so a
 * two-digit minor sorts correctly — `gpt-5.10` is newer than `gpt-5.4`, while
 * parseFloat would read it as 5.1 and call it older.
 */
function isNewerThanGpt54(modelId: string): boolean {
  const match = /^gpt-(\d+)\.(\d+)/.exec(modelId);
  if (match === null) return false;
  const major = Number.parseInt(match[1] ?? '', 10);
  const minor = Number.parseInt(match[2] ?? '', 10);
  if (!Number.isFinite(major) || !Number.isFinite(minor)) return false;
  const [minMajor, minMinor] = CHATGPT_MIN_EXCLUSIVE_VERSION;
  return major !== minMajor ? major > minMajor : minor > minMinor;
}

/**
 * ChatGPT authentication serves only the models above, and only under the
 * canonical `openai/<model>` key. Shared so the renderer offers exactly the
 * models the main process — and the backend — will accept in `chatgpt` mode.
 */
export function isOpenAiCodexModelKey(modelKey: string): boolean {
  const separator = modelKey.indexOf('/');
  if (separator <= 0) return false;
  if (modelKey.slice(0, separator) !== 'openai') return false;
  return isChatGptServedModelId(modelKey.slice(separator + 1));
}

/**
 * Pick the transport for an OpenAI model: a connected ChatGPT sign-in serves
 * the models it actually supports, everything else goes through the API key.
 */
export function resolveOpenAiAuthMode(modelKey: string, chatGptConnected: boolean): OpenAiAuthMode {
  return chatGptConnected && isOpenAiCodexModelKey(modelKey) ? 'chatgpt' : 'api-key';
}
