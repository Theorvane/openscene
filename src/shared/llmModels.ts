export type LlmProviderId = 'local_ollama' | 'openai' | 'anthropic' | 'google_gemini' | 'deepseek';

export type LlmModelCategory = 'editor-assistant' | 'video-prompt' | 'voice-script';

export type LlmModelBadge = 'LOCAL' | 'FAST' | 'SMART' | 'REASONING';

export interface LlmModelConfig {
  readonly id: string;
  readonly providerId: LlmProviderId;
  readonly label: string;
  readonly providerLabel: string;
  readonly description: string;
  readonly category: LlmModelCategory;
  readonly badge: LlmModelBadge;
  readonly defaultMode: 'local' | 'api';
  /** Whether this model can be selected and used in the current build. */
  readonly available: boolean;
  /**
   * Human-readable reason shown when available is false.
   * Cloud provider adapter must be implemented before this model can be used.
   */
  readonly unavailabilityReason?: string;
}

export const DEFAULT_LLM_MODELS: readonly LlmModelConfig[] = [
  // Local Models
  {
    id: 'qwen2.5-coder',
    providerId: 'local_ollama',
    label: 'Qwen 2.5 Coder 14B',
    providerLabel: 'Local Engine (Ollama)',
    description: 'High-performance offline local model for timeline scripts & prompts',
    category: 'editor-assistant',
    badge: 'LOCAL',
    defaultMode: 'local',
    available: true
  },
  {
    id: 'llama3.2-vision',
    providerId: 'local_ollama',
    label: 'Llama 3.2 Vision 11B',
    providerLabel: 'Local Engine (Ollama)',
    description: 'Local multimodal vision model for video scene analysis',
    category: 'video-prompt',
    badge: 'LOCAL',
    defaultMode: 'local',
    available: true
  },

  // Cloud Models - OpenAI
  {
    id: 'gpt-5',
    providerId: 'openai',
    label: 'GPT-5',
    providerLabel: 'OpenAI',
    description: 'Flagship reasoning & multimodal model for cinematic scriptwriting and agentic timeline edits',
    category: 'video-prompt',
    badge: 'REASONING',
    defaultMode: 'api',
    available: false,
    unavailabilityReason: 'OpenAI provider adapter not yet implemented'
  },
  {
    id: 'gpt-5-mini',
    providerId: 'openai',
    label: 'GPT-5 Mini',
    providerLabel: 'OpenAI',
    description: 'Fast lightweight model for instant timeline edits',
    category: 'editor-assistant',
    badge: 'FAST',
    defaultMode: 'api',
    available: false,
    unavailabilityReason: 'OpenAI provider adapter not yet implemented'
  },

  // Cloud Models - Anthropic
  {
    id: 'claude-opus-4-8',
    providerId: 'anthropic',
    label: 'Claude Opus 4.8',
    providerLabel: 'Anthropic',
    description: 'Most capable Claude model for storyboarding, scripts, and complex editing logic',
    category: 'voice-script',
    badge: 'REASONING',
    defaultMode: 'api',
    available: false,
    unavailabilityReason: 'Anthropic provider adapter not yet implemented'
  },
  {
    id: 'claude-sonnet-5',
    providerId: 'anthropic',
    label: 'Claude Sonnet 5',
    providerLabel: 'Anthropic',
    description: 'Balanced state-of-the-art model for narrative voiceovers & complex edits',
    category: 'voice-script',
    badge: 'SMART',
    defaultMode: 'api',
    available: false,
    unavailabilityReason: 'Anthropic provider adapter not yet implemented'
  },

  // Cloud Models - Google Gemini
  {
    id: 'gemini-3-pro',
    providerId: 'google_gemini',
    label: 'Gemini 3 Pro',
    providerLabel: 'Google Gemini',
    description: 'Long-context multimodal model for full video timeline analysis',
    category: 'editor-assistant',
    badge: 'SMART',
    defaultMode: 'api',
    available: false,
    unavailabilityReason: 'Google Gemini provider adapter not yet implemented'
  },
  {
    id: 'gemini-2.5-flash',
    providerId: 'google_gemini',
    label: 'Gemini 2.5 Flash',
    providerLabel: 'Google Gemini',
    description: 'Fast multimodal model integrated with Gemini Veo video generation',
    category: 'video-prompt',
    badge: 'FAST',
    defaultMode: 'api',
    available: false,
    unavailabilityReason: 'Google Gemini provider adapter not yet implemented'
  },

  // Cloud Models - DeepSeek
  {
    id: 'deepseek-v3.1',
    providerId: 'deepseek',
    label: 'DeepSeek V3.1',
    providerLabel: 'DeepSeek',
    description: 'Unified chat + reasoning open-weights model for scene sequencing & prompt optimization',
    category: 'editor-assistant',
    badge: 'REASONING',
    defaultMode: 'api',
    available: false,
    unavailabilityReason: 'DeepSeek provider adapter not yet implemented'
  },
  {
    id: 'deepseek-r1',
    providerId: 'deepseek',
    label: 'DeepSeek R1',
    providerLabel: 'DeepSeek',
    description: 'Open-weights reasoning specialist for scene sequencing & AI prompt optimization',
    category: 'editor-assistant',
    badge: 'REASONING',
    defaultMode: 'api',
    available: false,
    unavailabilityReason: 'DeepSeek provider adapter not yet implemented'
  }
] as const;

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

export function parseSelectedLlmModelId(storedId: string | null | undefined): string {
  if (!storedId) return DEFAULT_LLM_MODELS.find((m) => m.available)?.id ?? DEFAULT_LLM_MODELS[0]!.id;
  const match = DEFAULT_LLM_MODELS.find((m) => m.id === storedId && m.available);
  return match !== undefined ? match.id : (DEFAULT_LLM_MODELS.find((m) => m.available)?.id ?? DEFAULT_LLM_MODELS[0]!.id);
}
