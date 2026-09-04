import * as SecureStore from 'expo-secure-store';

/**
 * Provider keys live in the platform keystore — Keychain on iOS, Keystore on
 * Android — for the same reason the desktop app puts them in Electron
 * safeStorage rather than localStorage: anything the JS bundle can read at rest
 * is readable by anything that can read the bundle.
 */
export const PROVIDER_KEYS = [
  { slot: 'agentRouterApiKey', label: 'AgentRouter', hint: 'AgentRouter API key', providerId: 'agentrouter' },
  { slot: 'openaiApiKey', label: 'OpenAI', hint: 'sk-…', providerId: 'openai' },
  { slot: 'geminiApiKey', label: 'Google Gemini', hint: 'AIza…', providerId: 'google_gemini' },
  { slot: 'bytePlusApiKey', label: 'BytePlus ModelArk', hint: 'Bearer token', providerId: 'byteplus' },
  { slot: 'elevenlabsApiKey', label: 'ElevenLabs', hint: 'sk_…', providerId: 'elevenlabs' },
  { slot: 'stabilityApiKey', label: 'Stability AI', hint: 'sk-…', providerId: 'stability' },
  { slot: 'blackForestLabsApiKey', label: 'Black Forest Labs', hint: 'key', providerId: 'black_forest_labs' },
  { slot: 'dashscopeApiKey', label: 'Alibaba DashScope', hint: 'sk-…', providerId: 'alibaba_dashscope' },
  { slot: 'runwayApiKey', label: 'Runway', hint: 'key_…', providerId: 'runway' },
  { slot: 'klingApiKey', label: 'Kling', hint: 'key', providerId: 'kling' },
  { slot: 'lumaApiKey', label: 'Luma', hint: 'luma-…', providerId: 'luma' },
  { slot: 'minimaxApiKey', label: 'MiniMax Hailuo', hint: 'key', providerId: 'minimax_hailuo' },
  { slot: 'groqApiKey', label: 'Groq', hint: 'gsk_…', providerId: 'groq' }
] as const;

export type ProviderSlot = (typeof PROVIDER_KEYS)[number]['slot'];

/** SecureStore keys allow only alphanumerics, '.', '-' and '_'. */
const storeKey = (slot: string): string => `openvideo.${slot.replace(/[^A-Za-z0-9._-]/g, '_')}`;

/**
 * The LLM catalog carries 153 providers, so chat credentials are addressed by
 * the catalog's own `credentialKey` rather than a hand-written union. The media
 * slots above stay typed because their adapters are hand-written and finite.
 */
export async function readSlot(credentialKey: string): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(storeKey(credentialKey));
  } catch {
    return null;
  }
}

export async function writeSlot(credentialKey: string, value: string): Promise<void> {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    await SecureStore.deleteItemAsync(storeKey(credentialKey));
    return;
  }
  await SecureStore.setItemAsync(storeKey(credentialKey), trimmed);
}

export async function readKey(slot: ProviderSlot): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(storeKey(slot));
  } catch {
    // A keystore that cannot be read is indistinguishable from an empty one for
    // our purposes; the caller's "not connected" path is already correct.
    return null;
  }
}

export async function writeKey(slot: ProviderSlot, value: string): Promise<void> {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    await SecureStore.deleteItemAsync(storeKey(slot));
    return;
  }
  await SecureStore.setItemAsync(storeKey(slot), trimmed);
}

/** Only ever whether a key exists, never the key. */
export async function readConnectedSlots(): Promise<Readonly<Record<ProviderSlot, boolean>>> {
  const entries = await Promise.all(
    PROVIDER_KEYS.map(async ({ slot }) => [slot, (await readKey(slot)) !== null] as const)
  );
  return Object.fromEntries(entries) as Record<ProviderSlot, boolean>;
}
