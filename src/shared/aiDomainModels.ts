import { LLM_CATALOG } from './llmCatalog.generated';

export type AiDomain = 'voice-generation' | 'video-generation' | 'image-generation' | 'edit-agent';

export type AiDomainProvider = {
  readonly id: string;
  readonly label: string;
  readonly executionPath: 'local' | 'api';
};

export const AI_DOMAIN_PROVIDERS: readonly AiDomainProvider[] = [
  { id: 'local_ollama', label: 'Ollama', executionPath: 'local' },
  { id: 'openai', label: 'OpenAI', executionPath: 'api' },
  { id: 'anthropic', label: 'Anthropic', executionPath: 'api' },
  { id: 'google_gemini', label: 'Google Gemini', executionPath: 'api' },
  { id: 'deepseek', label: 'DeepSeek', executionPath: 'api' },
  { id: 'gemini', label: 'Google Gemini', executionPath: 'api' },
  { id: 'elevenlabs', label: 'ElevenLabs', executionPath: 'api' },
  { id: 'byteplus', label: 'BytePlus ModelArk', executionPath: 'api' },
  { id: 'stability', label: 'Stability AI', executionPath: 'api' },
  { id: 'black_forest_labs', label: 'Black Forest Labs', executionPath: 'api' },
  { id: 'alibaba_dashscope', label: 'Alibaba DashScope', executionPath: 'api' }
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
  /** Model supports a reasoning-effort setting. */
  readonly reasoning?: boolean;
  /** Effort levels this model accepts (its "variants"). */
  readonly efforts?: readonly string[];
};

export type AiDomainModelPreferences = Record<AiDomain, string>;

export const AI_DOMAIN_MODEL_STORAGE_KEY = 'openvideo-ai-domain-model-preferences-v1';

const AI_DOMAIN_MODEL_CATALOG: readonly AiDomainModelConfig[] = [
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
    providerId: 'minimax_hailuo',
    label: 'Hailuo 02',
    providerLabel: 'MiniMax Hailuo',
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
  // Every tool-calling model from the generated models.dev catalog is
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
        ...(model.reasoning === true ? { reasoning: true } : {}),
        ...(model.efforts === undefined ? {} : { efforts: model.efforts }),
        domains: ['edit-agent'],
        available: true
      }))
  ),
  // ── Image generation: cloud models. OpenAI Images, Google Imagen, and BytePlus
  // Seedream adapters are implemented; the rest stay honestly unavailable so the
  // picker never offers a model that would fail after the user hits Generate.
  {
    id: 'gpt-image-1',
    providerId: 'openai',
    label: 'GPT Image 1',
    providerLabel: 'OpenAI Images',
    description: 'OpenAI image model with strong prompt adherence and text rendering.',
    executionPath: 'api',
    domains: ['image-generation'],
    available: true
  },
  {
    id: 'dall-e-3',
    providerId: 'openai',
    label: 'DALL-E 3',
    providerLabel: 'OpenAI Images',
    description: 'Previous-generation OpenAI image model.',
    executionPath: 'api',
    domains: ['image-generation'],
    available: true
  },
  {
    id: 'imagen-4.0-generate-001',
    providerId: 'google_gemini',
    label: 'Imagen 4',
    providerLabel: 'Google Imagen',
    description: 'Google photorealistic image generation with native aspect ratios.',
    executionPath: 'api',
    domains: ['image-generation'],
    available: true
  },
  {
    id: 'imagen-4.0-ultra-generate-001',
    providerId: 'google_gemini',
    label: 'Imagen 4 Ultra',
    providerLabel: 'Google Imagen',
    description: 'Highest-fidelity Imagen tier, one image per request.',
    executionPath: 'api',
    domains: ['image-generation'],
    available: true
  },
  {
    id: 'imagen-3.0-generate-002',
    providerId: 'google_gemini',
    label: 'Imagen 3',
    providerLabel: 'Google Imagen',
    description: 'Previous-generation Imagen model.',
    executionPath: 'api',
    domains: ['image-generation'],
    available: true
  },
  {
    id: 'seedream-4-0-250828',
    providerId: 'byteplus',
    label: 'Seedream 4.0',
    providerLabel: 'BytePlus Seedream',
    description: 'ByteDance Seedream text-to-image and image editing, up to 4K.',
    executionPath: 'api',
    domains: ['image-generation'],
    available: true
  },
  {
    id: 'seedream-3-0-t2i-250415',
    providerId: 'byteplus',
    label: 'Seedream 3.0',
    providerLabel: 'BytePlus Seedream',
    description: 'Seedream 3.0 text-to-image with strong Chinese and English typography.',
    executionPath: 'api',
    domains: ['image-generation'],
    available: true
  },
  {
    id: 'seededit-3-0-i2i-250628',
    providerId: 'byteplus',
    label: 'SeedEdit 3.0',
    providerLabel: 'BytePlus Seedream',
    description: 'Instruction-driven image editing over a reference image.',
    executionPath: 'api',
    domains: ['image-generation'],
    available: true
  },
  {
    id: 'stable-image-ultra',
    providerId: 'stability',
    label: 'Stable Image Ultra',
    providerLabel: 'Stability AI',
    description: 'Stability flagship text-to-image.',
    executionPath: 'api',
    domains: ['image-generation'],
    available: false,
    unavailableReason: 'Stability AI adapter is not implemented in this build.'
  },
  {
    id: 'flux-pro-1.1',
    providerId: 'black_forest_labs',
    label: 'FLUX 1.1 Pro',
    providerLabel: 'Black Forest Labs',
    description: 'FLUX text-to-image with high prompt fidelity.',
    executionPath: 'api',
    domains: ['image-generation'],
    available: false,
    unavailableReason: 'Black Forest Labs adapter is not implemented in this build.'
  },
  {
    id: 'wan2.2-t2i-flash',
    providerId: 'alibaba_dashscope',
    label: 'Wan 2.2 T2I Flash',
    providerLabel: 'Alibaba Wan',
    description: 'Alibaba Wan text-to-image over DashScope.',
    executionPath: 'api',
    domains: ['image-generation'],
    available: false,
    unavailableReason: 'Alibaba DashScope adapter is not implemented in this build.'
  },
  {
    id: 'qwen-image',
    providerId: 'alibaba_dashscope',
    label: 'Qwen-Image',
    providerLabel: 'Alibaba Qwen',
    description: 'Qwen image generation with Chinese text rendering.',
    executionPath: 'api',
    domains: ['image-generation'],
    available: false,
    unavailableReason: 'Alibaba DashScope adapter is not implemented in this build.'
  }
];

const AI_DOMAINS: readonly AiDomain[] = ['voice-generation', 'video-generation', 'image-generation', 'edit-agent'];

export function formatAiModelOptionLabel(model: AiDomainModelConfig): string {
  const isZen = model.id === 'qwen2.5-coder';
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
      const normalizedCandidate = candidate?.startsWith('openai-codex/')
        ? `openai/${candidate.slice('openai-codex/'.length)}`
        : candidate;
      const model = normalizedCandidate === undefined ? undefined : getDomainModel(domain, normalizedCandidate);
      return [domain, model?.available ? model.id : getDefaultDomainModelId(domain)];
    })
  ) as AiDomainModelPreferences;
}
