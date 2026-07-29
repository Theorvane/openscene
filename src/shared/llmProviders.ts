import { LLM_CATALOG, type LlmCatalogProvider } from './llmCatalog.generated';

/**
 * opencode-style provider registry: a provider is a source of models with its
 * own connection method. The local Ollama engine is always usable; every cloud
 * provider from the generated models.dev catalog connects by storing an API
 * key in main-process safe storage and stays listed (but disabled) until
 * connected.
 */
export type LlmProviderKind = 'local' | 'cloud';
export type LlmProviderAuth = 'none' | 'api-key';
export type LlmProviderAdapter = 'ollama' | 'openai-compatible' | 'anthropic' | 'gemini';

export type LlmCredentialKey = string;

export interface LlmProviderInfo {
  readonly id: string;
  readonly label: string;
  readonly kind: LlmProviderKind;
  readonly auth: LlmProviderAuth;
  readonly adapter: LlmProviderAdapter;
  /** Safe-storage credential slot for api-key providers. */
  readonly credentialKey?: LlmCredentialKey;
  readonly keyPlaceholder?: string;
  /** OpenAI-compatible providers call this base URL. */
  readonly baseUrl?: string;
  /** Local engines expose a configurable base URL instead of a key. */
  readonly baseUrlConfigurable?: boolean;
  readonly description: string;
}

const KEY_PLACEHOLDERS: Readonly<Record<string, string>> = {
  openai: 'sk-proj-...',
  anthropic: 'sk-ant-...',
  google_gemini: 'AIzaSy...',
  deepseek: 'sk-...'
};

export const OLLAMA_PROVIDER: LlmProviderInfo = {
  id: 'local_ollama',
  label: 'Ollama',
  kind: 'local',
  auth: 'none',
  adapter: 'ollama',
  baseUrlConfigurable: true,
  description: 'Local engine over HTTP. No account or key; models run on this machine.'
};

function toProviderInfo(provider: LlmCatalogProvider): LlmProviderInfo {
  return {
    id: provider.id,
    label: provider.label,
    kind: 'cloud',
    auth: 'api-key',
    adapter: provider.adapter,
    credentialKey: provider.credentialKey,
    ...(KEY_PLACEHOLDERS[provider.id] === undefined ? {} : { keyPlaceholder: KEY_PLACEHOLDERS[provider.id] }),
    ...(provider.baseUrl === undefined ? {} : { baseUrl: provider.baseUrl }),
    description: `${provider.models.length} models over the ${provider.label} API.`
  };
}

export const LLM_PROVIDERS: readonly LlmProviderInfo[] = [
  OLLAMA_PROVIDER,
  ...LLM_CATALOG.map(toProviderInfo)
];

/** opencode-style popular shortlist shown before "Show all providers". */
export const POPULAR_LLM_PROVIDER_IDS: readonly string[] = [
  'anthropic',
  'openai',
  'google_gemini',
  'openrouter',
  'deepseek',
  'groq',
  'xai',
  'mistral'
];

const PROVIDERS_BY_ID = new Map(LLM_PROVIDERS.map((provider) => [provider.id, provider]));

export function getLlmProvider(id: string): LlmProviderInfo | undefined {
  return PROVIDERS_BY_ID.get(id);
}

export function getLlmCatalogProvider(id: string): LlmCatalogProvider | undefined {
  return LLM_CATALOG.find((provider) => provider.id === id);
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
