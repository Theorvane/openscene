export type VoiceChoice = { readonly id: string; readonly label: string; readonly description: string };
const OPENAI: readonly VoiceChoice[] = [
  ['alloy', 'Alloy', 'Neutral and balanced'], ['ash', 'Ash', 'Clear and conversational'],
  ['coral', 'Coral', 'Warm and expressive'], ['echo', 'Echo', 'Smooth and measured'],
  ['fable', 'Fable', 'Storytelling character'], ['nova', 'Nova', 'Bright and natural'],
  ['onyx', 'Onyx', 'Deep and authoritative'], ['sage', 'Sage', 'Calm and thoughtful'],
  ['shimmer', 'Shimmer', 'Light and upbeat']
].map(([id, label, description]) => ({ id: id!, label: label!, description: description! }));
const ELEVENLABS: readonly VoiceChoice[] = [
  { id: '21m00Tcm4TlvDq8ikWAM', label: 'Rachel', description: 'Calm and professional' },
  { id: 'AZnzlk1XvdvUeBnXmlld', label: 'Domi', description: 'Energetic' },
  { id: 'EXAVITQu4vr4xnSDxMaL', label: 'Bella', description: 'Expressive' },
  { id: 'ErXwobaYiN019PkySvjV', label: 'Antoni', description: 'Deep narrative' },
  { id: 'pNInz6obpgDQGcFmaJgB', label: 'Adam', description: 'Clear executive' }
];
export function voiceChoices(providerId: string): readonly VoiceChoice[] {
  return providerId === 'openai' ? OPENAI : providerId === 'elevenlabs' ? ELEVENLABS : [];
}

/** VieNeu voices are intentionally not frozen here; the local runtime owns its current preset catalog. */
export function usesRuntimeVoiceCatalog(providerId: string): boolean {
  return providerId === 'vieneu_local';
}
