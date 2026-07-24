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
    defaultMode: 'local'
  },
  {
    id: 'llama3.2-vision',
    providerId: 'local_ollama',
    label: 'Llama 3.2 Vision 11B',
    providerLabel: 'Local Engine (Ollama)',
    description: 'Local multimodal vision model for video scene analysis',
    category: 'video-prompt',
    badge: 'LOCAL',
    defaultMode: 'local'
  },

  // Cloud Models - OpenAI
  {
    id: 'gpt-4o',
    providerId: 'openai',
    label: 'GPT-4o',
    providerLabel: 'OpenAI',
    description: 'Omni multimodal model for cinematic scriptwriting & video prompt creation',
    category: 'video-prompt',
    badge: 'SMART',
    defaultMode: 'api'
  },
  {
    id: 'gpt-4o-mini',
    providerId: 'openai',
    label: 'GPT-4o Mini',
    providerLabel: 'OpenAI',
    description: 'Fast lightweight model for instant timeline edits',
    category: 'editor-assistant',
    badge: 'FAST',
    defaultMode: 'api'
  },

  // Cloud Models - Anthropic
  {
    id: 'claude-3-5-sonnet',
    providerId: 'anthropic',
    label: 'Claude 3.5 Sonnet',
    providerLabel: 'Anthropic',
    description: 'State-of-the-art reasoning model for narrative voiceovers & complex edits',
    category: 'voice-script',
    badge: 'SMART',
    defaultMode: 'api'
  },

  // Cloud Models - Google Gemini
  {
    id: 'gemini-2.0-flash',
    providerId: 'google_gemini',
    label: 'Gemini 2.0 Flash',
    providerLabel: 'Google Gemini',
    description: 'Ultra-fast multimodal model integrated with Gemini Veo video generation',
    category: 'video-prompt',
    badge: 'FAST',
    defaultMode: 'api'
  },
  {
    id: 'gemini-1.5-pro',
    providerId: 'google_gemini',
    label: 'Gemini 1.5 Pro',
    providerLabel: 'Google Gemini',
    description: 'Long-context multimodal model for full video timeline analysis',
    category: 'editor-assistant',
    badge: 'SMART',
    defaultMode: 'api'
  },

  // Cloud Models - DeepSeek
  {
    id: 'deepseek-r1',
    providerId: 'deepseek',
    label: 'DeepSeek R1',
    providerLabel: 'DeepSeek',
    description: 'Open-weights reasoning model for scene sequencing & AI prompt optimization',
    category: 'editor-assistant',
    badge: 'REASONING',
    defaultMode: 'api'
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
}

export function parseSelectedLlmModelId(storedId: string | null | undefined): string {
  if (!storedId) return DEFAULT_LLM_MODELS[0]!.id;
  const match = DEFAULT_LLM_MODELS.find((m) => m.id === storedId);
  return match !== undefined ? match.id : DEFAULT_LLM_MODELS[0]!.id;
}
