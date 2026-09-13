import { LLM_CATALOG } from './llmCatalog.generated';
import { AGENT_ROUTER_MODELS, AGENT_ROUTER_PROVIDER_ID } from './agentRouter';

export type LlmProviderId = string;

export type LlmModelCategory = 'editor-assistant' | 'video-prompt' | 'voice-script';

export type LlmModelBadge = 'LOCAL' | 'FAST' | 'SMART' | 'REASONING';

export interface LlmModelConfig {
  /** Canonical key: `providerId/modelId` for cloud, bare id for local. */
  readonly id: string;
  readonly providerId: LlmProviderId;
  readonly label: string;
  readonly providerLabel: string;
  readonly description: string;
  readonly category: LlmModelCategory;
  readonly badge: LlmModelBadge;
  readonly defaultMode: 'local' | 'api';
  /** Whether this model's provider adapter is implemented in the current build. */
  readonly available: boolean;
  readonly unavailabilityReason?: string;
  /** Whether the model supports structured tool calling (Edit Agent requirement). */
  readonly toolCall?: boolean;
  readonly contextWindow?: string;
  /** Whether the model accepts image input (needed to see watchProjectVideo frames). */
  readonly vision?: boolean;
}

/** Split a canonical model key into its provider and provider-native model id. */
export function parseLlmModelKey(key: string): { readonly providerId: string; readonly modelId: string } | null {
  const slash = key.indexOf('/');
  if (slash <= 0 || slash === key.length - 1) return null;
  return { providerId: key.slice(0, slash), modelId: key.slice(slash + 1) };
}

const LOCAL_LLM_MODELS: readonly LlmModelConfig[] = [
  {
    id: 'qwen2.5-coder',
    providerId: 'local_ollama',
    label: 'Qwen 2.5 Coder 14B',
    providerLabel: 'Ollama',
    description: 'High-performance offline local model for timeline scripts & prompts',
    category: 'editor-assistant',
    badge: 'LOCAL',
    defaultMode: 'local',
    available: true,
    toolCall: true,
    contextWindow: '32k'
  },
  {
    id: 'llama3.2-vision',
    providerId: 'local_ollama',
    label: 'Llama 3.2 Vision 11B',
    providerLabel: 'Ollama',
    description: 'Local multimodal vision model for video scene analysis',
    category: 'video-prompt',
    badge: 'LOCAL',
    defaultMode: 'local',
    available: true,
    vision: true,
    contextWindow: '128k'
  }
];

function describeCloudModel(providerLabel: string, flags: { toolCall?: boolean; reasoning?: boolean; vision?: boolean }): string {
  const traits = [
    flags.reasoning === true ? 'reasoning' : null,
    flags.toolCall === true ? 'tool calling' : null,
    flags.vision === true ? 'vision' : null
  ].filter((trait): trait is string => trait !== null);
  return traits.length > 0 ? `${providerLabel} model with ${traits.join(', ')}.` : `${providerLabel} model.`;
}

/** Full models.dev catalog flattened into canonical `providerId/modelId` entries. */
export const DEFAULT_LLM_MODELS: readonly LlmModelConfig[] = [
  ...LOCAL_LLM_MODELS,
  ...AGENT_ROUTER_MODELS.map((model): LlmModelConfig => ({
    id: `${AGENT_ROUTER_PROVIDER_ID}/${model.id}`,
    providerId: AGENT_ROUTER_PROVIDER_ID,
    label: model.label,
    providerLabel: 'AgentRouter',
    description: 'AgentRouter account model alias; runnable in desktop Writer through Codex CLI.',
    category: 'editor-assistant',
    badge: model.reasoning ? 'REASONING' : 'SMART',
    defaultMode: 'api',
    available: true,
    toolCall: true
  })),
  ...LLM_CATALOG.flatMap((provider) =>
    provider.models.map((model): LlmModelConfig => ({
      id: `${provider.id}/${model.id}`,
      providerId: provider.id,
      label: model.label,
      providerLabel: provider.label,
      description: describeCloudModel(provider.label, model),
      category: 'editor-assistant',
      badge: model.reasoning === true ? 'REASONING' : 'SMART',
      defaultMode: 'api',
      available: true,
      ...(model.toolCall === true ? { toolCall: true } : {}),
      ...(model.vision === true ? { vision: true } : {}),
      ...(model.contextK === undefined ? {} : { contextWindow: `${model.contextK}k` })
    }))
  )
];

const MODELS_BY_ID = new Map(DEFAULT_LLM_MODELS.map((model) => [model.id, model]));

export const LLM_STORAGE_MODEL_KEY = 'openvideo-selected-llm-model';
export const LLM_STORAGE_CONFIG_KEY = 'openvideo-llm-provider-config';

export interface LlmProviderApiConfig {
  ollamaBaseUrl?: string;
  openaiApiKey?: string;
  anthropicApiKey?: string;
  geminiApiKey?: string;
  deepseekApiKey?: string;
  elevenlabsApiKey?: string;
  runwayApiKey?: string;
  klingApiKey?: string;
  lumaApiKey?: string;
}

export function getLlmModel(modelId: string): LlmModelConfig | undefined {
  return MODELS_BY_ID.get(modelId);
}

export function parseSelectedLlmModelId(storedId: string | null | undefined): string {
  if (!storedId) return DEFAULT_LLM_MODELS.find((m) => m.available)?.id ?? DEFAULT_LLM_MODELS[0]!.id;
  const match = MODELS_BY_ID.get(storedId);
  return match !== undefined && match.available
    ? match.id
    : (DEFAULT_LLM_MODELS.find((m) => m.available)?.id ?? DEFAULT_LLM_MODELS[0]!.id);
}
