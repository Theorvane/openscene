import { safeStorage } from 'electron';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Per-provider API key slots. The four legacy LLM slots and the media-provider
 * slots keep their names; every other catalog provider stores under its own
 * provider id (e.g. `openrouter`, `groq`).
 */
export type ProviderCredentials = Record<string, string | undefined>;

export type CredentialStatusMap = Record<string, boolean>;

/** Slots that must always appear in the status map, even before anything is stored. */
const ALWAYS_REPORTED_CREDENTIAL_KEYS = [
  'openaiApiKey',
  'anthropicApiKey',
  'geminiApiKey',
  'deepseekApiKey',
  'elevenlabsApiKey',
  'runwayApiKey',
  'klingApiKey',
  'lumaApiKey',
  'bytePlusApiKey'
] as const;

export class CredentialStore {
  private readonly filePath: string;
  private memoryCache: ProviderCredentials = {};

  constructor(directory: string) {
    this.filePath = join(directory, 'encrypted_credentials.bin');
  }

  private isEncryptionSupported(): boolean {
    return safeStorage !== undefined && typeof safeStorage.isEncryptionAvailable === 'function' && safeStorage.isEncryptionAvailable();
  }

  async getCredentials(): Promise<ProviderCredentials> {
    try {
      const buffer = await readFile(this.filePath);
      if (!this.isEncryptionSupported()) {
        throw new Error('Electron safeStorage encryption is unavailable on this system.');
      }
      const decrypted = safeStorage.decryptString(buffer);
      this.memoryCache = JSON.parse(decrypted) as ProviderCredentials;
      return { ...this.memoryCache };
    } catch (err) {
      if (err instanceof Error && err.message.includes('safeStorage')) {
        throw err;
      }
      return { ...this.memoryCache };
    }
  }

  async getCredentialStatus(): Promise<CredentialStatusMap> {
    const creds = await this.getCredentials();
    const status: Record<string, boolean> = {};
    for (const key of ALWAYS_REPORTED_CREDENTIAL_KEYS) {
      status[key] = false;
    }
    for (const [key, value] of Object.entries(creds)) {
      status[key] = typeof value === 'string' && value.trim().length > 0;
    }
    return status;
  }

  async getCredentialValue(provider: keyof ProviderCredentials): Promise<string | undefined> {
    const creds = await this.getCredentials();
    return creds[provider];
  }

  async setCredential(provider: keyof ProviderCredentials, apiKey: string): Promise<void> {
    if (!this.isEncryptionSupported()) {
      throw new Error('Electron safeStorage encryption is unavailable on this system.');
    }

    await this.getCredentials();
    this.memoryCache = { ...this.memoryCache, [provider]: apiKey };

    const jsonString = JSON.stringify(this.memoryCache);
    const outputBuffer = safeStorage.encryptString(jsonString);

    const dir = join(this.filePath, '..');
    await mkdir(dir, { recursive: true });
    await writeFile(this.filePath, outputBuffer);
  }
}
