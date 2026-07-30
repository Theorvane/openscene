import * as SecureStore from 'expo-secure-store';

/**
 * Provider keys live in the platform keystore — Keychain on iOS, Keystore on
 * Android — for the same reason the desktop app puts them in Electron
 * safeStorage rather than localStorage: anything the JS bundle can read at rest
 * is readable by anything that can read the bundle.
 */
export const PROVIDER_KEYS = [
  { slot: 'openaiApiKey', label: 'OpenAI', hint: 'sk-…' },
  { slot: 'geminiApiKey', label: 'Google Gemini', hint: 'AIza…' },
  { slot: 'bytePlusApiKey', label: 'BytePlus ModelArk', hint: 'Bearer token' }
] as const;

export type ProviderSlot = (typeof PROVIDER_KEYS)[number]['slot'];

/** SecureStore keys allow only alphanumerics, '.', '-' and '_'. */
const storeKey = (slot: ProviderSlot): string => `openvideo.${slot}`;

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
