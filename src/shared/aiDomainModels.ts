export type AiDomain = 'voice-generation' | 'video-generation' | 'edit-agent';

export type AiDomainProvider = {
  readonly id: string;
  readonly label: string;
  readonly executionPath: 'local' | 'api';
};

export const AI_DOMAIN_PROVIDERS: readonly AiDomainProvider[] = [
  { id: 'local_ollama', label: 'Ollama', executionPath: 'local' },
  { id: 'local_qwen', label: 'Local Engine', executionPath: 'local' },
  { id: 'local_video', label: 'Local Engine', executionPath: 'local' },
  { id: 'openai', label: 'OpenAI', executionPath: 'api' },
  { id: 'anthropic', label: 'Anthropic', executionPath: 'api' },
  { id: 'google_gemini', label: 'Google Gemini', executionPath: 'api' },
  { id: 'deepseek', label: 'DeepSeek', executionPath: 'api' },
  { id: 'gemini', label: 'Google Gemini', executionPath: 'api' },
  { id: 'elevenlabs', label: 'ElevenLabs', executionPath: 'api' }
] as const;

export type AiDomainModelConfig = {
  readonly id: string;
  readonly providerId: string;
  readonly label: string;
  readonly providerLabel: string;
  readonly description: string;
  readonly executionPath: 'local' | 'api';
  readonly domains: readonly AiDomain[];
  readonly available: boolean;
  readonly unavailableReason?: string;
  readonly contextWindow?: string;
  readonly availableContexts?: readonly string[];
  readonly precisionBit?: string;
  readonly availablePrecisions?: readonly string[];
};

export type AiDomainModelPreferences = Record<AiDomain, string>;

export const AI_DOMAIN_MODEL_STORAGE_KEY = 'openvideo-ai-domain-model-preferences-v1';

const AI_DOMAIN_MODEL_CATALOG: readonly AiDomainModelConfig[] = [
  {
    id: 'local-qwen-tts',
    providerId: 'local_qwen',
    label: 'Qwen Speech Synthesis',
    providerLabel: 'Local Engine',
    description: 'User-configured local Qwen speech synthesis runner.',
    executionPath: 'local',
    precisionBit: '16-bit',
    availablePrecisions: ['8-bit', '16-bit', 'FP32'],
    domains: ['voice-generation'],
    available: true
  },
  {
    id: 'elevenlabs-multilingual-v2',
    providerId: 'elevenlabs',
    label: 'Multilingual v2',
    providerLabel: 'ElevenLabs',
    description: 'Cloud speech synthesis model.',
    executionPath: 'api',
    contextWindow: '128k',
    availableContexts: ['32k', '64k', '128k'],
    domains: ['voice-generation'],
    available: false,
    unavailableReason: 'ElevenLabs adapter is not implemented in this build.'
  },
  {
    id: 'local-video-runner',
    providerId: 'local_video',
    label: 'Video Synthesis Runner',
    providerLabel: 'Local Engine',
    description: 'User-configured local video synthesis runner.',
    executionPath: 'local',
    precisionBit: 'FP16',
    availablePrecisions: ['8-bit (Q8_0)', 'FP16', 'FP32'],
    domains: ['video-generation'],
    available: true
  },
  {
    id: 'gemini-veo',
    providerId: 'gemini',
    label: 'Veo Video Generator',
    providerLabel: 'Google Gemini',
    description: 'Cloud video generation model.',
    executionPath: 'api',
    contextWindow: '1M',
    availableContexts: ['128k', '512k', '1M'],
    domains: ['video-generation'],
    available: false,
    unavailableReason: 'Gemini Veo adapter is not implemented in this build.'
  },
  {
    id: 'openai-sora',
    providerId: 'openai',
    label: 'Sora',
    providerLabel: 'OpenAI',
    description: 'Cloud video generation model.',
    executionPath: 'api',
    contextWindow: '128k',
    availableContexts: ['32k', '64k', '128k'],
    domains: ['video-generation'],
    available: false,
    unavailableReason: 'OpenAI Sora adapter is not implemented in this build.'
  },
  {
    id: 'qwen2.5-coder',
    providerId: 'local_ollama',
    label: 'Qwen 2.5 Coder 14B',
    providerLabel: 'Ollama',
    description: 'Local tool-calling model for LangGraph edit operations.',
    executionPath: 'local',
    precisionBit: '4-bit (Q4_K_M)',
    availablePrecisions: ['4-bit (Q4_K_M)', '8-bit (Q8_0)', '16-bit (FP16)'],
    domains: ['edit-agent'],
    available: true
  },
  {
    id: 'gpt-5-mini',
    providerId: 'openai',
    label: 'GPT-5 Mini',
    providerLabel: 'OpenAI',
    description: 'Fast cloud tool-calling model for agentic timeline editing.',
    executionPath: 'api',
    contextWindow: '256k',
    availableContexts: ['32k', '64k', '128k', '256k'],
    domains: ['edit-agent'],
    available: true
  },
  {
    id: 'gpt-5',
    providerId: 'openai',
    label: 'GPT-5',
    providerLabel: 'OpenAI',
    description: 'Flagship cloud reasoning model for complex agentic edits.',
    executionPath: 'api',
    contextWindow: '256k',
    availableContexts: ['64k', '128k', '256k'],
    domains: ['edit-agent'],
    available: true
  },
  {
    id: 'claude-sonnet-5',
    providerId: 'anthropic',
    label: 'Claude Sonnet 5',
    providerLabel: 'Anthropic',
    description: 'Balanced cloud tool-calling model for timeline edits.',
    executionPath: 'api',
    contextWindow: '200k',
    availableContexts: ['64k', '128k', '200k'],
    domains: ['edit-agent'],
    available: true
  },
  {
    id: 'claude-opus-4-8',
    providerId: 'anthropic',
    label: 'Claude Opus 4.8',
    providerLabel: 'Anthropic',
    description: 'Most capable Claude model for complex editing logic.',
    executionPath: 'api',
    contextWindow: '200k',
    availableContexts: ['64k', '128k', '200k'],
    domains: ['edit-agent'],
    available: true
  },
  {
    id: 'gemini-3-pro',
    providerId: 'google_gemini',
    label: 'Gemini 3 Pro',
    providerLabel: 'Google Gemini',
    description: 'Long-context cloud model for full-timeline agentic edits.',
    executionPath: 'api',
    contextWindow: '1M',
    availableContexts: ['128k', '512k', '1M'],
    domains: ['edit-agent'],
    available: true
  },
  {
    id: 'deepseek-v3.1',
    providerId: 'deepseek',
    label: 'DeepSeek V3.1',
    providerLabel: 'DeepSeek',
    description: 'Open-weights cloud tool-calling model for scene sequencing.',
    executionPath: 'api',
    contextWindow: '128k',
    availableContexts: ['32k', '64k', '128k'],
    domains: ['edit-agent'],
    available: true
  }
] as const;

const AI_DOMAINS: readonly AiDomain[] = ['voice-generation', 'video-generation', 'edit-agent'];

export function formatAiModelOptionLabel(model: AiDomainModelConfig): string {
  const isZen = model.id === 'qwen2.5-coder' || model.id === 'local-video-runner' || model.id === 'local-qwen-tts';
  const prefix = isZen ? '★ ' : '';
  const statusSuffix = model.available ? '' : ' (Unavailable)';
  return `${prefix}${model.providerLabel} → ${model.label}${statusSuffix}`;
}

export function getDomainModels(domain: AiDomain): readonly AiDomainModelConfig[] {
  return AI_DOMAIN_MODEL_CATALOG.filter((model) => model.domains.includes(domain));
}

export function getAvailableDomainModels(domain: AiDomain): readonly AiDomainModelConfig[] {
  return getDomainModels(domain).filter((model) => model.available);
}

export function getDomainModel(domain: AiDomain, modelId: string): AiDomainModelConfig | undefined {
  return getDomainModels(domain).find((model) => model.id === modelId);
}

export function getDefaultDomainModelId(domain: AiDomain): string {
  const model = getAvailableDomainModels(domain)[0];
  if (model === undefined) {
    throw new Error(`No available AI model is configured for domain ${domain}.`);
  }
  return model.id;
}

export function parseAiDomainModelPreferences(stored: Partial<Record<AiDomain, string>> | null | undefined): AiDomainModelPreferences {
  return Object.fromEntries(
    AI_DOMAINS.map((domain) => {
      const candidate = stored?.[domain];
      const model = candidate === undefined ? undefined : getDomainModel(domain, candidate);
      return [domain, model?.available ? model.id : getDefaultDomainModelId(domain)];
    })
  ) as AiDomainModelPreferences;
}
