import { LLM_CATALOG } from './llmCatalog.generated';

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
  // ── Voice generation: cloud TTS models. ElevenLabs and OpenAI adapters are
  // implemented; the rest stay honestly unavailable until an adapter lands.
  {
    id: 'eleven_v3',
    providerId: 'elevenlabs',
    label: 'Eleven v3',
    providerLabel: 'ElevenLabs',
    description: 'Most expressive ElevenLabs speech synthesis model.',
    executionPath: 'api',
    domains: ['voice-generation'],
    available: true
  },
  {
    id: 'eleven_multilingual_v2',
    providerId: 'elevenlabs',
    label: 'Multilingual v2',
    providerLabel: 'ElevenLabs',
    description: 'Stable multilingual ElevenLabs speech synthesis (29 languages).',
    executionPath: 'api',
    domains: ['voice-generation'],
    available: true
  },
  {
    id: 'eleven_turbo_v2_5',
    providerId: 'elevenlabs',
    label: 'Turbo v2.5',
    providerLabel: 'ElevenLabs',
    description: 'Low-latency ElevenLabs synthesis at reduced cost.',
    executionPath: 'api',
    domains: ['voice-generation'],
    available: true
  },
  {
    id: 'eleven_flash_v2_5',
    providerId: 'elevenlabs',
    label: 'Flash v2.5',
    providerLabel: 'ElevenLabs',
    description: 'Fastest ElevenLabs synthesis (~75ms latency).',
    executionPath: 'api',
    domains: ['voice-generation'],
    available: true
  },
  {
    id: 'gpt-4o-mini-tts',
    providerId: 'openai',
    label: 'GPT-4o mini TTS',
    providerLabel: 'OpenAI',
    description: 'Steerable OpenAI speech synthesis model.',
    executionPath: 'api',
    domains: ['voice-generation'],
    available: true
  },
  {
    id: 'tts-1-hd',
    providerId: 'openai',
    label: 'TTS-1 HD',
    providerLabel: 'OpenAI',
    description: 'High-quality OpenAI speech synthesis.',
    executionPath: 'api',
    domains: ['voice-generation'],
    available: true
  },
  {
    id: 'tts-1',
    providerId: 'openai',
    label: 'TTS-1',
    providerLabel: 'OpenAI',
    description: 'Low-latency OpenAI speech synthesis.',
    executionPath: 'api',
    domains: ['voice-generation'],
    available: true
  },
  {
    id: 'gemini-2.5-flash-preview-tts',
    providerId: 'google_gemini',
    label: 'Gemini 2.5 Flash TTS',
    providerLabel: 'Google Gemini',
    description: 'Controllable Gemini speech generation.',
    executionPath: 'api',
    domains: ['voice-generation'],
    available: false,
    unavailableReason: 'Gemini TTS adapter is not implemented in this build.'
  },
  {
    id: 'gemini-2.5-pro-preview-tts',
    providerId: 'google_gemini',
    label: 'Gemini 2.5 Pro TTS',
    providerLabel: 'Google Gemini',
    description: 'Highest-quality Gemini speech generation.',
    executionPath: 'api',
    domains: ['voice-generation'],
    available: false,
    unavailableReason: 'Gemini TTS adapter is not implemented in this build.'
  },
  {
    id: 'playai-tts',
    providerId: 'groq',
    label: 'PlayAI TTS',
    providerLabel: 'Groq',
    description: 'PlayAI Dialog speech synthesis served by Groq.',
    executionPath: 'api',
    domains: ['voice-generation'],
    available: false,
    unavailableReason: 'Groq PlayAI TTS adapter is not implemented in this build.'
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
  // ── Video generation: cloud models. Veo (Gemini API) and Sora (OpenAI API)
  // adapters are implemented; the rest stay honestly unavailable.
  {
    id: 'veo-3.1-generate-preview',
    providerId: 'google_gemini',
    label: 'Veo 3.1 (Preview)',
    providerLabel: 'Google Veo',
    description: 'Latest Veo text-to-video with native audio.',
    executionPath: 'api',
    domains: ['video-generation'],
    available: true
  },
  {
    id: 'veo-3.0-generate-001',
    providerId: 'google_gemini',
    label: 'Veo 3',
    providerLabel: 'Google Veo',
    description: 'Stable Veo 3 text-to-video with native audio.',
    executionPath: 'api',
    domains: ['video-generation'],
    available: true
  },
  {
    id: 'veo-3.0-fast-generate-001',
    providerId: 'google_gemini',
    label: 'Veo 3 Fast',
    providerLabel: 'Google Veo',
    description: 'Faster, cheaper Veo 3 text-to-video.',
    executionPath: 'api',
    domains: ['video-generation'],
    available: true
  },
  {
    id: 'veo-2.0-generate-001',
    providerId: 'google_gemini',
    label: 'Veo 2',
    providerLabel: 'Google Veo',
    description: 'Previous-generation Veo text-to-video.',
    executionPath: 'api',
    domains: ['video-generation'],
    available: true
  },
  {
    id: 'sora-2',
    providerId: 'openai',
    label: 'Sora 2',
    providerLabel: 'OpenAI Sora',
    description: 'OpenAI text-to-video with synced audio.',
    executionPath: 'api',
    domains: ['video-generation'],
    available: true
  },
  {
    id: 'sora-2-pro',
    providerId: 'openai',
    label: 'Sora 2 Pro',
    providerLabel: 'OpenAI Sora',
    description: 'Higher-fidelity OpenAI text-to-video.',
    executionPath: 'api',
    domains: ['video-generation'],
    available: true
  },
  {
    id: 'gen4_turbo',
    providerId: 'runway',
    label: 'Runway Gen-4 Turbo',
    providerLabel: 'Runway',
    description: 'Runway image/text-to-video generation.',
    executionPath: 'api',
    domains: ['video-generation'],
    available: false,
    unavailableReason: 'Runway adapter is not implemented in this build.'
  },
  {
    id: 'gen4_aleph',
    providerId: 'runway',
    label: 'Runway Aleph',
    providerLabel: 'Runway',
    description: 'Runway in-context video editing model.',
    executionPath: 'api',
    domains: ['video-generation'],
    available: false,
    unavailableReason: 'Runway adapter is not implemented in this build.'
  },
  {
    id: 'kling-v2.5-turbo',
    providerId: 'kling',
    label: 'Kling 2.5 Turbo',
    providerLabel: 'Kling',
    description: 'Kuaishou Kling text-to-video generation.',
    executionPath: 'api',
    domains: ['video-generation'],
    available: false,
    unavailableReason: 'Kling adapter is not implemented in this build.'
  },
  {
    id: 'kling-v2.1-master',
    providerId: 'kling',
    label: 'Kling 2.1 Master',
    providerLabel: 'Kling',
    description: 'High-fidelity Kling text/image-to-video.',
    executionPath: 'api',
    domains: ['video-generation'],
    available: false,
    unavailableReason: 'Kling adapter is not implemented in this build.'
  },
  {
    id: 'ray-2',
    providerId: 'luma',
    label: 'Luma Ray 2',
    providerLabel: 'Luma',
    description: 'Luma Dream Machine text-to-video.',
    executionPath: 'api',
    domains: ['video-generation'],
    available: false,
    unavailableReason: 'Luma adapter is not implemented in this build.'
  },
  {
    id: 'ray-flash-2',
    providerId: 'luma',
    label: 'Luma Ray Flash 2',
    providerLabel: 'Luma',
    description: 'Faster, cheaper Luma text-to-video.',
    executionPath: 'api',
    domains: ['video-generation'],
    available: false,
    unavailableReason: 'Luma adapter is not implemented in this build.'
  },
  {
    id: 'minimax-hailuo-02',
    providerId: 'minimax',
    label: 'Hailuo 02',
    providerLabel: 'MiniMax',
    description: 'MiniMax Hailuo text/image-to-video.',
    executionPath: 'api',
    domains: ['video-generation'],
    available: false,
    unavailableReason: 'MiniMax adapter is not implemented in this build.'
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
  // Every tool-calling model from the generated opencode/models.dev catalog is
  // an edit-agent candidate; the picker gates them on provider connection.
  ...LLM_CATALOG.flatMap((provider) =>
    provider.models
      .filter((model) => model.toolCall === true)
      .map((model): AiDomainModelConfig => ({
        id: `${provider.id}/${model.id}`,
        providerId: provider.id,
        label: model.label,
        providerLabel: provider.label,
        description: `${provider.label} cloud tool-calling model for agentic timeline editing.`,
        executionPath: 'api',
        ...(model.contextK === undefined ? {} : { contextWindow: `${model.contextK}k` }),
        domains: ['edit-agent'],
        available: true
      }))
  )
];

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
