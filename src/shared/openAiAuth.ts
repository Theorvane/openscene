export type OpenAiAuthMode = 'api-key' | 'chatgpt';

export function isOpenAiAuthMode(value: unknown): value is OpenAiAuthMode {
  return value === 'api-key' || value === 'chatgpt';
}

export type ChatGptOAuthStatus =
  | { readonly kind: 'connected' }
  | { readonly kind: 'disconnected' };

/**
 * ChatGPT authentication only serves the Codex model family, and only under the
 * canonical `openai/<model>` key. Shared so the renderer offers exactly the
 * models the main process will accept in `chatgpt` mode.
 */
export function isOpenAiCodexModelKey(modelKey: string): boolean {
  const separator = modelKey.indexOf('/');
  if (separator <= 0) return false;
  return modelKey.slice(0, separator) === 'openai' && modelKey.slice(separator + 1).includes('codex');
}

/**
 * Pick the transport for an OpenAI model: a connected ChatGPT sign-in serves
 * Codex-family models, everything else goes through the API key.
 */
export function resolveOpenAiAuthMode(modelKey: string, chatGptConnected: boolean): OpenAiAuthMode {
  return chatGptConnected && isOpenAiCodexModelKey(modelKey) ? 'chatgpt' : 'api-key';
}
