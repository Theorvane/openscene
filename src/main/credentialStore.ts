import { safeStorage } from 'electron';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface ProviderCredentials {
  openaiApiKey?: string;
  anthropicApiKey?: string;
  geminiApiKey?: string;
  deepseekApiKey?: string;
}

export type CredentialStatusMap = Record<keyof ProviderCredentials, boolean>;

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
    return {
      openaiApiKey: Boolean(creds.openaiApiKey && creds.openaiApiKey.trim().length > 0),
      anthropicApiKey: Boolean(creds.anthropicApiKey && creds.anthropicApiKey.trim().length > 0),
      geminiApiKey: Boolean(creds.geminiApiKey && creds.geminiApiKey.trim().length > 0),
      deepseekApiKey: Boolean(creds.deepseekApiKey && creds.deepseekApiKey.trim().length > 0)
    };
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
