import type { LlmProviderId } from './llmModels';

/**
 * opencode-style provider registry: a provider is a source of models with its
 * own connection method. Local providers are always usable; cloud providers
 * connect by storing an API key in main-process safe storage and stay listed
 * (but disabled) until they are connected.
 */
export type LlmProviderKind = 'local' | 'cloud';
export type LlmProviderAuth = 'none' | 'api-key';

export type LlmCredentialKey = 'openaiApiKey' | 'anthropicApiKey' | 'geminiApiKey' | 'deepseekApiKey';

export interface LlmProviderInfo {
  readonly id: LlmProviderId;
  readonly label: string;
  readonly kind: LlmProviderKind;
  readonly auth: LlmProviderAuth;
  /** Safe-storage credential slot for api-key providers. */
  readonly credentialKey?: LlmCredentialKey;
  readonly keyPlaceholder?: string;
  /** Local engines expose a configurable base URL instead of a key. */
  readonly baseUrlConfigurable?: boolean;
  readonly description: string;
}

export const LLM_PROVIDERS: readonly LlmProviderInfo[] = [
  {
    id: 'local_ollama',
    label: 'Ollama',
    kind: 'local',
    auth: 'none',
    baseUrlConfigurable: true,
    description: 'Local engine over HTTP. No account or key; models run on this machine.'
  },
  {
    id: 'openai',
    label: 'OpenAI',
    kind: 'cloud',
    auth: 'api-key',
    credentialKey: 'openaiApiKey',
    keyPlaceholder: 'sk-proj-...',
    description: 'GPT models over the OpenAI API.'
  },
  {
    id: 'anthropic',
    label: 'Anthropic',
    kind: 'cloud',
    auth: 'api-key',
    credentialKey: 'anthropicApiKey',
    keyPlaceholder: 'sk-ant-...',
    description: 'Claude models over the Anthropic API.'
  },
  {
    id: 'google_gemini',
    label: 'Google Gemini',
    kind: 'cloud',
    auth: 'api-key',
    credentialKey: 'geminiApiKey',
    keyPlaceholder: 'AIzaSy...',
    description: 'Gemini models over the Google Generative Language API.'
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    kind: 'cloud',
    auth: 'api-key',
    credentialKey: 'deepseekApiKey',
    keyPlaceholder: 'sk-...',
    description: 'DeepSeek models over their OpenAI-compatible API.'
  }
] as const;

export function getLlmProvider(id: string): LlmProviderInfo | undefined {
  return LLM_PROVIDERS.find((provider) => provider.id === id);
}

/**
 * A provider is connected when it needs no credential (local) or its API key
 * is present in safe storage. The renderer only ever sees the boolean status
 * map, never key material.
 */
export function isProviderConnected(
  providerId: string,
  credentialStatus: Readonly<Record<string, boolean>>
): boolean {
  const provider = getLlmProvider(providerId);
  if (provider === undefined) return false;
  if (provider.auth === 'none') return true;
  return provider.credentialKey !== undefined && credentialStatus[provider.credentialKey] === true;
}
