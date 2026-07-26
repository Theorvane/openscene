export type AiDomain = 'voice-generation' | 'video-generation' | 'edit-agent';

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
};

export type AiDomainModelPreferences = Record<AiDomain, string>;

export const AI_DOMAIN_MODEL_STORAGE_KEY = 'openvideo-ai-domain-model-preferences-v1';

const AI_DOMAIN_MODEL_CATALOG: readonly AiDomainModelConfig[] = [
  {
    id: 'local-qwen-tts',
    providerId: 'local_qwen',
    label: 'Local Qwen TTS',
    providerLabel: 'Local Engine',
    description: 'User-configured local Qwen speech synthesis runner.',
    executionPath: 'local',
    domains: ['voice-generation'],
    available: true
  },
  {
    id: 'elevenlabs-multilingual-v2',
    providerId: 'elevenlabs',
    label: 'ElevenLabs Multilingual v2',
    providerLabel: 'ElevenLabs',
    description: 'Cloud speech synthesis model.',
    executionPath: 'api',
    domains: ['voice-generation'],
    available: false,
    unavailableReason: 'ElevenLabs adapter is not implemented in this build.'
  },
  {
    id: 'local-video-runner',
    providerId: 'local_video',
    label: 'Local Video Runner',
    providerLabel: 'Local Engine',
    description: 'User-configured local video synthesis runner.',
    executionPath: 'local',
    domains: ['video-generation'],
    available: true
  },
  {
    id: 'gemini-veo',
    providerId: 'gemini_veo',
    label: 'Gemini Veo',
    providerLabel: 'Google Gemini',
    description: 'Cloud video generation model.',
    executionPath: 'api',
    domains: ['video-generation'],
    available: false,
    unavailableReason: 'Gemini Veo adapter is not implemented in this build.'
  },
  {
    id: 'openai-sora',
    providerId: 'openai_sora',
    label: 'OpenAI Sora',
    providerLabel: 'OpenAI',
    description: 'Cloud video generation model.',
    executionPath: 'api',
    domains: ['video-generation'],
    available: false,
    unavailableReason: 'OpenAI Sora adapter is not implemented in this build.'
  },
  {
    id: 'qwen2.5-coder',
    providerId: 'local_ollama',
    label: 'Qwen 2.5 Coder 14B',
    providerLabel: 'Local Engine (Ollama)',
    description: 'Local tool-calling model for LangGraph edit operations.',
    executionPath: 'local',
    domains: ['edit-agent'],
    available: true
  },
  {
    id: 'gpt-5-mini',
    providerId: 'openai',
    label: 'GPT-5 Mini',
    providerLabel: 'OpenAI',
    description: 'Cloud tool-calling model for agentic timeline editing.',
    executionPath: 'api',
    domains: ['edit-agent'],
    available: false,
    unavailableReason: 'OpenAI tool-calling adapter is not implemented in this build.'
  }
] as const;

const AI_DOMAINS: readonly AiDomain[] = ['voice-generation', 'video-generation', 'edit-agent'];

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
