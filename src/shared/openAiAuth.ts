export type OpenAiAuthMode = 'api-key' | 'chatgpt';

export function isOpenAiAuthMode(value: unknown): value is OpenAiAuthMode {
  return value === 'api-key' || value === 'chatgpt';
}

/**
 * Reasoning effort — opencode calls this a model "variant". The accepted values
 * come from the model's own catalog entry (e.g. none/low/medium/high/xhigh), and
 * `undefined` means the provider default.
 */
export type ReasoningEffort = string;

export type ChatGptOAuthStatus =
  | { readonly kind: 'connected' }
  | { readonly kind: 'disconnected' };

/**
 * Models the ChatGPT Codex backend actually serves, mirroring opencode's rule:
 * an explicit allow list, an explicit deny list, and otherwise only OpenAI
 * models newer than gpt-5.4. Anything else is rejected by the backend with a
 * bare 400, so it must never be offered on the sign-in transport.
 */
const CHATGPT_ALLOWED_MODEL_IDS = new Set(['gpt-5.5', 'gpt-5.3-codex-spark', 'gpt-5.4', 'gpt-5.4-mini']);
// opencode's snapshot also excludes the bare `gpt-5.6` id while admitting its
// variants; we admit the whole 5.6 family and let the backend be the authority.
const CHATGPT_DENIED_MODEL_IDS = new Set(['gpt-5.5-pro']);

function isChatGptServedModelId(modelId: string): boolean {
  if (CHATGPT_ALLOWED_MODEL_IDS.has(modelId)) return true;
  if (CHATGPT_DENIED_MODEL_IDS.has(modelId)) return false;
  if (modelId.endsWith('-pro')) return false;
  const version = /^gpt-(\d+\.\d+)/.exec(modelId)?.[1];
  return version === undefined ? false : Number.parseFloat(version) > 5.4;
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
