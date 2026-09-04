/**
 * Versioned media-model capabilities shared by desktop, mobile, planning and
 * execution. Provider documentation says what a model can do; `implemented`
 * says what this OpenScene build can actually send without dropping inputs.
 */

export const MEDIA_CAPABILITY_REGISTRY_VERSION = 1 as const;
export const MEDIA_CAPABILITIES_AS_OF = '2026-09-02' as const;

export const VIDEO_OPERATIONS = [
  'text_to_video',
  'image_to_video',
  'reference_to_video',
  'start_end',
  'video_edit',
  'video_extend',
  'motion_control'
] as const;

export type VideoOperation = (typeof VIDEO_OPERATIONS)[number];
export type VideoAspectRatio = '16:9' | '9:16' | '1:1';
export type VideoResolution = '480p' | '720p' | '1080p' | '4k';

export type VideoOperationConstraints = {
  readonly durationSeconds: readonly number[];
  readonly aspectRatios: readonly VideoAspectRatio[];
  readonly resolutions: readonly VideoResolution[];
  readonly minReferenceImages?: number;
  readonly maxReferenceImages?: number;
  readonly nativeAudio: boolean;
  readonly notes?: readonly string[];
};

export type VideoProviderBinding = {
  readonly adapterId: 'google_veo' | 'openai_sora' | 'runway' | 'luma';
  readonly credentialKey: 'geminiApiKey' | 'openaiApiKey' | 'runwayApiKey' | 'lumaApiKey';
  readonly seamProviderId: 'gemini_veo' | 'openai_sora' | 'runway_gen4' | 'luma_dream';
};

export type VideoModelCapabilities = {
  readonly registryVersion: typeof MEDIA_CAPABILITY_REGISTRY_VERSION;
  readonly modelId: string;
  readonly providerId: string;
  readonly providerLabel: string;
  readonly label: string;
  readonly description: string;
  readonly documentedAsOf: string;
  readonly sourceUrls: readonly string[];
  /** Operations documented by the provider, whether or not OpenScene can send them yet. */
  readonly operations: Partial<Readonly<Record<VideoOperation, VideoOperationConstraints>>>;
  /** Operations whose complete inputs the current adapter sends. */
  readonly implemented: readonly VideoOperation[];
  readonly binding?: VideoProviderBinding;
  readonly unavailableReason?: string;
};

const range = (minimum: number, maximum: number): readonly number[] =>
  Array.from({ length: maximum - minimum + 1 }, (_, index) => minimum + index);

const GOOGLE_VIDEO_SOURCE = 'https://ai.google.dev/gemini-api/docs/video';
const GOOGLE_MODELS_SOURCE = 'https://ai.google.dev/gemini-api/docs/models';
const XAI_VIDEO_SOURCE = 'https://docs.x.ai/developers/model-capabilities/video/generation';
const XAI_EDIT_SOURCE = 'https://docs.x.ai/developers/model-capabilities/video/editing';
const XAI_EXTEND_SOURCE = 'https://docs.x.ai/developers/model-capabilities/video/extension';

const LANDSCAPE_PORTRAIT: readonly VideoAspectRatio[] = ['16:9', '9:16'];
const ALL_APP_RATIOS: readonly VideoAspectRatio[] = ['16:9', '9:16', '1:1'];
const GOOGLE_BINDING: VideoProviderBinding = {
  adapterId: 'google_veo', credentialKey: 'geminiApiKey', seamProviderId: 'gemini_veo'
};
const OPENAI_BINDING: VideoProviderBinding = {
  adapterId: 'openai_sora', credentialKey: 'openaiApiKey', seamProviderId: 'openai_sora'
};
const RUNWAY_BINDING: VideoProviderBinding = {
  adapterId: 'runway', credentialKey: 'runwayApiKey', seamProviderId: 'runway_gen4'
};
const LUMA_BINDING: VideoProviderBinding = {
  adapterId: 'luma', credentialKey: 'lumaApiKey', seamProviderId: 'luma_dream'
};

const operation = (
  durationSeconds: readonly number[],
  aspectRatios: readonly VideoAspectRatio[],
  resolutions: readonly VideoResolution[],
  nativeAudio: boolean,
  extras: Omit<VideoOperationConstraints, 'durationSeconds' | 'aspectRatios' | 'resolutions' | 'nativeAudio'> = {}
): VideoOperationConstraints => ({ durationSeconds, aspectRatios, resolutions, nativeAudio, ...extras });

const veo31Common = operation([4, 6, 8], LANDSCAPE_PORTRAIT, ['720p', '1080p', '4k'], true, {
  notes: ['1080p and 4k require 8 seconds.']
});
const veo31Reference = operation([8], LANDSCAPE_PORTRAIT, ['720p', '1080p', '4k'], true, {
  minReferenceImages: 1,
  maxReferenceImages: 3,
  notes: ['Reference-image generation requires 8 seconds.']
});
const veo31StartEnd = operation([4, 6, 8], LANDSCAPE_PORTRAIT, ['720p', '1080p', '4k'], true, {
  minReferenceImages: 2,
  maxReferenceImages: 2
});
const veo31Extend = operation([7], LANDSCAPE_PORTRAIT, ['720p'], true, {
  notes: ['Only eligible Veo-generated 720p videos can be extended.']
});

const model = (
  value: Omit<VideoModelCapabilities, 'registryVersion' | 'documentedAsOf'> & { readonly documentedAsOf?: string }
): VideoModelCapabilities => ({
  registryVersion: MEDIA_CAPABILITY_REGISTRY_VERSION,
  documentedAsOf: value.documentedAsOf ?? MEDIA_CAPABILITIES_AS_OF,
  ...value
});

export const VIDEO_MODEL_CAPABILITIES: readonly VideoModelCapabilities[] = [
  model({
    modelId: 'veo-3.1-generate-preview', providerId: 'google_gemini', providerLabel: 'Google Veo',
    label: 'Veo 3.1 (Preview)', description: 'Veo video generation with native audio and advanced frame controls.',
    sourceUrls: [GOOGLE_VIDEO_SOURCE, GOOGLE_MODELS_SOURCE], binding: GOOGLE_BINDING,
    operations: {
      text_to_video: veo31Common,
      image_to_video: veo31Common,
      reference_to_video: veo31Reference,
      start_end: veo31StartEnd,
      video_extend: veo31Extend
    },
    implemented: ['text_to_video', 'image_to_video']
  }),
  model({
    modelId: 'veo-3.0-generate-001', providerId: 'google_gemini', providerLabel: 'Google Veo',
    label: 'Veo 3', description: 'Stable Veo 3 text/image-to-video with native audio.',
    sourceUrls: [GOOGLE_VIDEO_SOURCE], binding: GOOGLE_BINDING,
    operations: {
      text_to_video: operation([8], ['16:9'], ['720p', '1080p'], true),
      image_to_video: operation([8], ['16:9'], ['720p', '1080p'], true)
    },
    implemented: ['text_to_video', 'image_to_video']
  }),
  model({
    modelId: 'veo-3.0-fast-generate-001', providerId: 'google_gemini', providerLabel: 'Google Veo',
    label: 'Veo 3 Fast', description: 'Faster stable Veo 3 text/image-to-video.',
    sourceUrls: [GOOGLE_VIDEO_SOURCE], binding: GOOGLE_BINDING,
    operations: {
      text_to_video: operation([8], ['16:9'], ['720p', '1080p'], true),
      image_to_video: operation([8], ['16:9'], ['720p', '1080p'], true)
    },
    implemented: ['text_to_video', 'image_to_video']
  }),
  model({
    modelId: 'veo-2.0-generate-001', providerId: 'google_gemini', providerLabel: 'Google Veo',
    label: 'Veo 2', description: 'Previous-generation silent Veo text/image-to-video.',
    sourceUrls: [GOOGLE_VIDEO_SOURCE], binding: GOOGLE_BINDING,
    operations: {
      text_to_video: operation([5, 6, 7, 8], LANDSCAPE_PORTRAIT, ['720p'], false),
      image_to_video: operation([5, 6, 7, 8], LANDSCAPE_PORTRAIT, ['720p'], false)
    },
    implemented: ['text_to_video', 'image_to_video']
  }),
  model({
    modelId: 'sora-2', providerId: 'openai', providerLabel: 'OpenAI Sora', label: 'Sora 2',
    description: 'OpenAI video generation with synchronized audio.', sourceUrls: [], binding: OPENAI_BINDING,
    operations: {
      text_to_video: operation([4, 8, 12], LANDSCAPE_PORTRAIT, ['720p'], true),
      image_to_video: operation([4, 8, 12], LANDSCAPE_PORTRAIT, ['720p'], true)
    },
    implemented: ['text_to_video']
  }),
  model({
    modelId: 'sora-2-pro', providerId: 'openai', providerLabel: 'OpenAI Sora', label: 'Sora 2 Pro',
    description: 'Higher-fidelity OpenAI video generation.', sourceUrls: [], binding: OPENAI_BINDING,
    operations: {
      text_to_video: operation([4, 8, 12], LANDSCAPE_PORTRAIT, ['720p', '1080p'], true),
      image_to_video: operation([4, 8, 12], LANDSCAPE_PORTRAIT, ['720p', '1080p'], true)
    },
    implemented: ['text_to_video']
  }),
  ...([
    ['gen4.5', 'Gen-4.5', range(2, 10), 'Runway text/image-to-video, 2-10s.'],
    ['gen4_turbo', 'Gen-4 Turbo', range(2, 10), 'Runway text/image-to-video, 2-10s.'],
    ['seedance2', 'Seedance 2.0', range(4, 15), 'Seedance via Runway, 4-15s.'],
    ['seedance2_fast', 'Seedance 2.0 Fast', range(4, 15), 'Faster Seedance via Runway, 4-15s.'],
    ['seedance2_mini', 'Seedance 2.0 Mini', range(4, 15), 'Compact Seedance via Runway, 4-15s.'],
    ['veo3.1', 'Veo 3.1 (via Runway)', [4, 6, 8], 'Google Veo 3.1 served through Runway.'],
    ['veo3.1_fast', 'Veo 3.1 Fast (via Runway)', [4, 6, 8], 'Fast Veo 3.1 served through Runway.'],
    ['happyhorse_1_0', 'HappyHorse 1.0', range(3, 15), 'Text or first-frame video through Runway.'],
    ['gemini_omni_flash', 'Gemini Omni Flash', range(3, 10), 'Gemini Omni Flash video through Runway.']
  ] as const).map(([modelId, label, durationSeconds, description]) => model({
    modelId,
    providerId: 'runway', providerLabel: 'Runway', label, description,
    sourceUrls: [], binding: RUNWAY_BINDING,
    operations: {
      text_to_video: operation(durationSeconds, LANDSCAPE_PORTRAIT, ['720p'], true),
      image_to_video: operation(durationSeconds, LANDSCAPE_PORTRAIT, ['720p'], true)
    },
    implemented: ['text_to_video', 'image_to_video']
  })),
  model({
    modelId: 'aleph2', providerId: 'runway', providerLabel: 'Runway', label: 'Aleph 2.0',
    description: 'In-context video editing over an existing video.', sourceUrls: [], binding: RUNWAY_BINDING,
    operations: { video_edit: operation([], LANDSCAPE_PORTRAIT, ['720p'], true) }, implemented: [],
    unavailableReason: 'The current Runway adapter does not send a source video.'
  }),
  ...['ray-2', 'ray-flash-2'].map((modelId) => model({
    modelId, providerId: 'luma', providerLabel: 'Luma',
    label: modelId === 'ray-2' ? 'Ray 2' : 'Ray 2 Flash', description: 'Luma Dream Machine video generation.',
    sourceUrls: [], binding: LUMA_BINDING,
    operations: {
      text_to_video: operation([5, 9], LANDSCAPE_PORTRAIT, ['720p'], false),
      image_to_video: operation([5, 9], LANDSCAPE_PORTRAIT, ['720p'], false)
    },
    implemented: ['text_to_video'],
    unavailableReason: 'Inline image input is not implemented; Luma currently requires a hosted image URL.'
  })),
  ...([
    ['kling-v2.5-turbo', 'Kling 2.5 Turbo', 'kling', 'Kling'],
    ['kling-v2.1-master', 'Kling 2.1 Master', 'kling', 'Kling'],
    ['minimax-hailuo-02', 'Hailuo 02', 'minimax_hailuo', 'MiniMax Hailuo']
  ] as const).map(([modelId, label, providerId, providerLabel]) => model({
    modelId, providerId, providerLabel, label, description: `${providerLabel} video generation.`, sourceUrls: [],
    operations: { text_to_video: operation([4, 8], LANDSCAPE_PORTRAIT, ['720p'], false) }, implemented: [],
    unavailableReason: `${providerLabel} adapter is not implemented in this build.`
  })),
  model({
    modelId: 'grok-imagine-video-1.5', providerId: 'xai', providerLabel: 'xAI Grok Imagine',
    label: 'Grok Imagine Video 1.5', description: 'xAI text, image, and multi-reference video generation.',
    sourceUrls: [XAI_VIDEO_SOURCE],
    operations: {
      text_to_video: operation(range(1, 15), ALL_APP_RATIOS, ['480p', '720p', '1080p'], true),
      image_to_video: operation(range(1, 15), ALL_APP_RATIOS, ['480p', '720p', '1080p'], true, { minReferenceImages: 1, maxReferenceImages: 1 }),
      reference_to_video: operation(range(1, 15), ALL_APP_RATIOS, ['480p', '720p'], true, { minReferenceImages: 1 })
    },
    implemented: [], unavailableReason: 'The xAI API adapter is deferred; Grok browser-session smoke testing is tracked separately.'
  }),
  model({
    modelId: 'grok-imagine-video', providerId: 'xai', providerLabel: 'xAI Grok Imagine',
    label: 'Grok Imagine Video Edit/Extend', description: 'xAI video editing and extension operations.',
    sourceUrls: [XAI_EDIT_SOURCE, XAI_EXTEND_SOURCE],
    operations: {
      video_edit: operation([], ALL_APP_RATIOS, ['480p', '720p'], true, { notes: ['Input video must be at most 8.7 seconds.'] }),
      video_extend: operation(range(2, 10), ALL_APP_RATIOS, ['480p', '720p'], true, { notes: ['Input video must be 2-15 seconds; output keeps its shape and is capped at 720p.'] })
    },
    implemented: [], unavailableReason: 'The xAI edit/extend adapter is not implemented in this build.'
  })
];

export function getVideoModelCapabilities(modelId: string): VideoModelCapabilities | undefined {
  return VIDEO_MODEL_CAPABILITIES.find((entry) => entry.modelId === modelId);
}

export function getVideoOperationConstraints(
  modelId: string,
  operationId: VideoOperation
): VideoOperationConstraints | undefined {
  return getVideoModelCapabilities(modelId)?.operations[operationId];
}

export function isVideoOperationImplemented(modelId: string, operationId: VideoOperation): boolean {
  return getVideoModelCapabilities(modelId)?.implemented.includes(operationId) === true;
}

export function getVideoProviderBinding(modelId: string): VideoProviderBinding | undefined {
  return getVideoModelCapabilities(modelId)?.binding;
}

export type VideoRequestValidation =
  | { readonly ok: true; readonly model: VideoModelCapabilities; readonly constraints: VideoOperationConstraints }
  | { readonly ok: false; readonly code: 'UNKNOWN_MODEL' | 'UNSUPPORTED_OPERATION' | 'NOT_IMPLEMENTED' | 'INVALID_DURATION' | 'INVALID_ASPECT_RATIO' | 'INVALID_REFERENCE_COUNT'; readonly message: string };

export function validateVideoRequest(input: {
  readonly modelId: string;
  readonly operation: VideoOperation;
  readonly durationSeconds: number;
  readonly aspectRatio: VideoAspectRatio;
  readonly referenceImageCount?: number;
  readonly requireImplemented?: boolean;
}): VideoRequestValidation {
  const modelCapabilities = getVideoModelCapabilities(input.modelId);
  if (modelCapabilities === undefined) {
    return { ok: false, code: 'UNKNOWN_MODEL', message: `Video model ${input.modelId} is not in the capability registry.` };
  }
  const constraints = modelCapabilities.operations[input.operation];
  if (constraints === undefined) {
    return { ok: false, code: 'UNSUPPORTED_OPERATION', message: `${modelCapabilities.label} does not support ${input.operation}.` };
  }
  if (input.requireImplemented !== false && !modelCapabilities.implemented.includes(input.operation)) {
    return { ok: false, code: 'NOT_IMPLEMENTED', message: `${modelCapabilities.label} supports ${input.operation}, but this OpenScene build does not implement that request path yet.` };
  }
  if (!Number.isFinite(input.durationSeconds) || !constraints.durationSeconds.includes(input.durationSeconds)) {
    return { ok: false, code: 'INVALID_DURATION', message: `${modelCapabilities.label} accepts ${constraints.durationSeconds.join(', ')} second ${input.operation} clips.` };
  }
  if (!constraints.aspectRatios.includes(input.aspectRatio)) {
    return { ok: false, code: 'INVALID_ASPECT_RATIO', message: `${modelCapabilities.label} accepts ${constraints.aspectRatios.join(' or ')} for ${input.operation}.` };
  }
  const referenceCount = input.referenceImageCount ?? 0;
  const minimum = constraints.minReferenceImages ?? (input.operation === 'image_to_video' ? 1 : 0);
  const maximum = constraints.maxReferenceImages ?? (input.operation === 'image_to_video' ? 1 : minimum === 0 ? 0 : Number.MAX_SAFE_INTEGER);
  if (referenceCount < minimum || referenceCount > maximum) {
    return { ok: false, code: 'INVALID_REFERENCE_COUNT', message: `${modelCapabilities.label} expects ${minimum === maximum ? minimum : `${minimum}-${maximum}`} reference image(s) for ${input.operation}.` };
  }
  return { ok: true, model: modelCapabilities, constraints };
}

export function inferImplementedVideoOperation(modelId: string, referenceImageCount: number): VideoOperation {
  if (referenceImageCount > 0 && isVideoOperationImplemented(modelId, 'image_to_video')) return 'image_to_video';
  return 'text_to_video';
}

/** Model-specific controls; providerId fallback preserves older planner callers. */
export function videoControlConstraints(modelOrProviderId: string, operationId: VideoOperation = 'text_to_video'): VideoOperationConstraints {
  const exact = getVideoOperationConstraints(modelOrProviderId, operationId);
  if (exact !== undefined) return exact;
  const providerDefault = VIDEO_MODEL_CAPABILITIES.find(
    (entry) => entry.providerId === modelOrProviderId && entry.implemented.includes(operationId)
  )?.operations[operationId];
  return providerDefault ?? operation([4, 8], LANDSCAPE_PORTRAIT, ['720p'], false);
}
