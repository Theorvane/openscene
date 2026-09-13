import { hasAllowedKeys, isPlainRecord } from './timelineValidationPrimitives';

export type VoiceDeliverySettings = {
  /** Provider-facing text; narration and subtitle text stay clean. */
  readonly performanceScript: string;
  readonly stability: number;
  readonly similarityBoost: number;
  readonly style: number;
  readonly speed: number;
  readonly speakerBoost: boolean;
};

export const DEFAULT_VOICE_DELIVERY_SETTINGS: Omit<VoiceDeliverySettings, 'performanceScript'> = {
  stability: 0.5,
  similarityBoost: 0.75,
  style: 0,
  speed: 1,
  speakerBoost: true
};

export type VoiceDeliveryCue = {
  readonly token: string;
  readonly label: string;
  readonly description: string;
};

export type VoiceDeliveryCapabilities = {
  readonly kind: 'eleven-v3' | 'eleven-v2' | 'vieneu-v3' | 'plain';
  readonly title: string;
  readonly guidance: string;
  readonly cues: readonly VoiceDeliveryCue[];
  readonly supportsStability: boolean;
  readonly supportsAdvancedVoiceSettings: boolean;
};

const ELEVEN_V3_CUES: readonly VoiceDeliveryCue[] = [
  { token: '[curious]', label: 'Curious', description: 'A curious delivery' },
  { token: '[excited]', label: 'Excited', description: 'More energy and enthusiasm' },
  { token: '[whispers]', label: 'Whisper', description: 'A whispered delivery' },
  { token: '[shouts]', label: 'Shout', description: 'A shouted delivery' },
  { token: '[laughs]', label: 'Laugh', description: 'Add a laugh' },
  { token: '[sighs]', label: 'Sigh', description: 'Add a sigh' }
];

const ELEVEN_V2_CUES: readonly VoiceDeliveryCue[] = [
  { token: '<break time="0.5s" />', label: 'Pause 0.5s', description: 'Insert a short SSML pause' },
  { token: '<break time="1.0s" />', label: 'Pause 1s', description: 'Insert a one-second SSML pause' }
];

const VIENEU_V3_CUES: readonly VoiceDeliveryCue[] = [
  { token: '[cười]', label: 'Cười', description: 'Cue tiếng cười thử nghiệm' },
  { token: '[thở dài]', label: 'Thở dài', description: 'Cue tiếng thở dài thử nghiệm' },
  { token: '[hắng giọng]', label: 'Hắng giọng', description: 'Cue hắng giọng thử nghiệm' }
];

export function createVoiceDeliverySettings(
  performanceScript: string,
  overrides: Partial<Omit<VoiceDeliverySettings, 'performanceScript'>> = {}
): VoiceDeliverySettings {
  return { performanceScript: performanceScript.trim(), ...DEFAULT_VOICE_DELIVERY_SETTINGS, ...overrides };
}

export function parseVoiceDeliverySettings(value: unknown): VoiceDeliverySettings | null {
  if (!isPlainRecord(value) || !hasAllowedKeys(value, [
    'performanceScript', 'stability', 'similarityBoost', 'style', 'speed', 'speakerBoost'
  ]) ||
    typeof value.performanceScript !== 'string' || !value.performanceScript.trim() || value.performanceScript.length > 200_000 ||
    typeof value.stability !== 'number' || !Number.isFinite(value.stability) || value.stability < 0 || value.stability > 1 ||
    typeof value.similarityBoost !== 'number' || !Number.isFinite(value.similarityBoost) || value.similarityBoost < 0 || value.similarityBoost > 1 ||
    typeof value.style !== 'number' || !Number.isFinite(value.style) || value.style < 0 || value.style > 1 ||
    typeof value.speed !== 'number' || !Number.isFinite(value.speed) || value.speed < 0.7 || value.speed > 1.2 ||
    typeof value.speakerBoost !== 'boolean') return null;

  return {
    performanceScript: value.performanceScript.trim(),
    stability: value.stability,
    similarityBoost: value.similarityBoost,
    style: value.style,
    speed: value.speed,
    speakerBoost: value.speakerBoost
  };
}

export function voiceDeliveryCapabilities(providerId: string, modelId: string): VoiceDeliveryCapabilities {
  if (providerId === 'elevenlabs' && modelId === 'eleven_v3') {
    return {
      kind: 'eleven-v3', title: 'Eleven v3 expressive delivery',
      guidance: 'Add audio tags before the words they affect. Lower stability is usually more expressive; higher stability is more consistent. v3 does not use SSML breaks.',
      cues: ELEVEN_V3_CUES, supportsStability: true, supportsAdvancedVoiceSettings: false
    };
  }
  if (providerId === 'elevenlabs') {
    return {
      kind: 'eleven-v2', title: 'ElevenLabs voice delivery',
      guidance: 'Use punctuation and SSML breaks for rhythm, then tune stability, similarity, style and speed. High style values can reduce stability.',
      cues: ELEVEN_V2_CUES, supportsStability: true, supportsAdvancedVoiceSettings: true
    };
  }
  if (providerId === 'vieneu_local') {
    return {
      kind: 'vieneu-v3', title: 'VieNeu v3 Turbo delivery',
      guidance: 'VieNeu v3 Turbo follows the selected preset/reference voice. It currently supports only the three experimental non-verbal cues below; punctuation and sentence length control the remaining rhythm.',
      cues: VIENEU_V3_CUES, supportsStability: false, supportsAdvancedVoiceSettings: false
    };
  }
  return {
    kind: 'plain', title: 'Voice delivery',
    guidance: 'Use punctuation, sentence length and line breaks to guide rhythm. This adapter does not expose additional delivery controls yet.',
    cues: [], supportsStability: false, supportsAdvancedVoiceSettings: false
  };
}
