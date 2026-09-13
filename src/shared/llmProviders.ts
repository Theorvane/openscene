import { LLM_CATALOG, type LlmCatalogProvider } from './llmCatalog.generated';
import {
  AGENT_ROUTER_BASE_URL,
  AGENT_ROUTER_CREDENTIAL_KEY,
  AGENT_ROUTER_PROVIDER_ID
} from './agentRouter';

/**
 * Provider registry: a provider is a source of models with its
 * own connection method. The local Ollama engine is always usable; every cloud
 * provider from the generated models.dev catalog connects by storing an API
 * key in main-process safe storage and stays listed (but disabled) until
 * connected.
 */
export type LlmProviderKind = 'local' | 'cloud';
export type LlmProviderAuth = 'none' | 'api-key' | 'oauth';
export type LlmProviderAdapter = 'ollama' | 'openai-compatible' | 'anthropic' | 'gemini' | 'media';

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

export const AGENT_ROUTER_PROVIDER: LlmProviderInfo = {
  id: AGENT_ROUTER_PROVIDER_ID,
  label: 'AgentRouter',
  kind: 'cloud',
  auth: 'api-key',
  adapter: 'openai-compatible',
  credentialKey: AGENT_ROUTER_CREDENTIAL_KEY,
  keyPlaceholder: 'AgentRouter API key',
  baseUrl: AGENT_ROUTER_BASE_URL,
  description: 'AgentRouter account routed through an installed Codex CLI client for desktop Writer generation.'
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

/**
 * Media-generation providers (voice/video APIs). They connect exactly like LLM
 * providers — an API key in safe storage — but expose no chat models; their
 * models live in the voice/video generation domain catalogs.
 */
export const MEDIA_PROVIDERS: readonly LlmProviderInfo[] = [
  {
    id: 'elevenlabs',
    label: 'ElevenLabs',
    kind: 'cloud',
    auth: 'api-key',
    adapter: 'media',
    credentialKey: 'elevenlabsApiKey',
    keyPlaceholder: 'sk_...',
    description: 'Speech synthesis over the ElevenLabs API.'
  },
  {
    id: 'runway',
    label: 'Runway',
    kind: 'cloud',
    auth: 'api-key',
    adapter: 'media',
    credentialKey: 'runwayApiKey',
    keyPlaceholder: 'key_...',
    description: 'Video generation over the Runway API.'
  },
  {
    id: 'kling',
    label: 'Kling',
    kind: 'cloud',
    auth: 'api-key',
    adapter: 'media',
    credentialKey: 'klingApiKey',
    description: 'Video generation over the Kling API.'
  },
  {
    id: 'luma',
    label: 'Luma',
    kind: 'cloud',
    auth: 'api-key',
    adapter: 'media',
    credentialKey: 'lumaApiKey',
    keyPlaceholder: 'luma-...',
    description: 'Video generation over the Luma Dream Machine API.'
  },
  {
    // Distinct from the catalog's `minimax` chat provider; both read the same
    // MiniMax credential slot, so one key connects chat and video.
    id: 'minimax_hailuo',
    label: 'MiniMax Hailuo',
    kind: 'cloud',
    auth: 'api-key',
    adapter: 'media',
    credentialKey: 'minimax',
    description: 'Video generation over the MiniMax Hailuo API.'
  },
  {
    id: 'byteplus',
    label: 'BytePlus ModelArk',
    kind: 'cloud',
    auth: 'api-key',
    adapter: 'media',
    credentialKey: 'bytePlusApiKey',
    description: 'ByteDance Seedream image generation and Seedance video over BytePlus ModelArk.'
  },
  {
    id: 'stability',
    label: 'Stability AI',
    kind: 'cloud',
    auth: 'api-key',
    adapter: 'media',
    credentialKey: 'stabilityApiKey',
    keyPlaceholder: 'sk-...',
    description: 'Image generation over the Stability AI API.'
  },
  {
    id: 'black_forest_labs',
    label: 'Black Forest Labs',
    kind: 'cloud',
    auth: 'api-key',
    adapter: 'media',
    credentialKey: 'blackForestLabsApiKey',
    description: 'FLUX image generation over the Black Forest Labs API.'
  },
  {
    id: 'alibaba_dashscope',
    label: 'Alibaba DashScope',
    kind: 'cloud',
    auth: 'api-key',
    adapter: 'media',
    credentialKey: 'dashscopeApiKey',
    description: 'Alibaba Wan and Qwen image and video generation over DashScope.'
  }
];

export const LLM_PROVIDERS: readonly LlmProviderInfo[] = [
  OLLAMA_PROVIDER,
  AGENT_ROUTER_PROVIDER,
  ...LLM_CATALOG.map(toProviderInfo),
  ...MEDIA_PROVIDERS
];

/** Popular shortlist shown before "Show all providers". */
export const POPULAR_LLM_PROVIDER_IDS: readonly string[] = [
  AGENT_ROUTER_PROVIDER_ID,
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
