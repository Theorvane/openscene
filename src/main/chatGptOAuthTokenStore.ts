import { safeStorage } from 'electron';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';

const tokenBundleSchema = z.object({
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1),
  expiresAt: z.number().int().nonnegative(),
  accountId: z.string().min(1)
}).strict();

type ChatGptOAuthTokenBundle = z.infer<typeof tokenBundleSchema>;

export type SafeStorageAdapter = {
  readonly isEncryptionAvailable: () => boolean;
  readonly encryptString: (plaintext: string) => Buffer;
  readonly decryptString: (encrypted: Buffer) => string;
};

export class ChatGptOAuthTokenStoreError extends Error {
  override readonly name = 'ChatGptOAuthTokenStoreError';
}

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

export class ChatGptOAuthTokenStore {
  private readonly directory: string;
  private readonly filePath: string;
  private readonly encryption: SafeStorageAdapter;

  constructor(directory: string, encryption: SafeStorageAdapter = safeStorage) {
    this.directory = directory;
    this.filePath = join(directory, 'encrypted_chatgpt_oauth.bin');
    this.encryption = encryption;
  }

  async load(): Promise<ChatGptOAuthTokenBundle | null> {
    let encrypted: Buffer;
    try {
      encrypted = await readFile(this.filePath);
    } catch (error) {
      if (isMissingFile(error)) {
        return null;
      }
      throw new ChatGptOAuthTokenStoreError('Could not read encrypted ChatGPT OAuth credentials.', { cause: error });
    }

    this.requireEncryption();
    try {
      const payload: unknown = JSON.parse(this.encryption.decryptString(encrypted));
      return tokenBundleSchema.parse(payload);
    } catch (error) {
      throw new ChatGptOAuthTokenStoreError('Encrypted ChatGPT OAuth credentials were invalid.', { cause: error });
    }
  }

  async save(bundle: ChatGptOAuthTokenBundle): Promise<void> {
    this.requireEncryption();
    const validated = tokenBundleSchema.parse(bundle);
    const encrypted = this.encryption.encryptString(JSON.stringify(validated));
    await mkdir(this.directory, { recursive: true });
    await writeFile(this.filePath, encrypted);
  }

  async clear(): Promise<void> {
    try {
      await unlink(this.filePath);
    } catch (error) {
      if (!isMissingFile(error)) {
        throw new ChatGptOAuthTokenStoreError('Could not remove ChatGPT OAuth credentials.', { cause: error });
      }
    }
  }

  private requireEncryption(): void {
    if (!this.encryption.isEncryptionAvailable()) {
      throw new ChatGptOAuthTokenStoreError('Electron safeStorage encryption is unavailable on this system.');
    }
  }
}
