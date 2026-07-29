import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (text: string) => Buffer.from(text, 'utf8'),
    decryptString: (buffer: Buffer) => buffer.toString('utf8')
  }
}));

import { ChatGptOAuthTokenStore } from '../src/main/chatGptOAuthTokenStore';
import { CredentialStore } from '../src/main/credentialStore';

const encryptedStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (text: string) => Buffer.from(text, 'utf8').reverse(),
  decryptString: (buffer: Buffer) => Buffer.from(buffer).reverse().toString('utf8')
};

describe('ChatGptOAuthTokenStore', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'openvideo-chatgpt-oauth-store-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('stores OAuth tokens separately without changing the OpenAI API key', async () => {
    // Given
    const credentialStore = new CredentialStore(tempDir);
    await credentialStore.setCredential('openaiApiKey', 'sk-existing-api-key');
    const tokenStore = new ChatGptOAuthTokenStore(tempDir, encryptedStorage);

    // When
    await tokenStore.save({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      expiresAt: 1_800_000_000_000,
      accountId: 'account-123'
    });

    // Then
    await expect(tokenStore.load()).resolves.toEqual({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      expiresAt: 1_800_000_000_000,
      accountId: 'account-123'
    });
    await expect(credentialStore.getCredentialValue('openaiApiKey')).resolves.toBe('sk-existing-api-key');
  });

  it('fails closed when safeStorage encryption is unavailable', async () => {
    // Given
    const tokenStore = new ChatGptOAuthTokenStore(tempDir, {
      ...encryptedStorage,
      isEncryptionAvailable: () => false
    });

    // When
    const save = tokenStore.save({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      expiresAt: 1_800_000_000_000,
      accountId: 'account-123'
    });

    // Then
    await expect(save).rejects.toThrow('safeStorage encryption is unavailable');
    await expect(new ChatGptOAuthTokenStore(tempDir, encryptedStorage).load()).resolves.toBeNull();
  });

  it('rejects a malformed encrypted token payload', async () => {
    // Given
    await writeFile(join(tempDir, 'encrypted_chatgpt_oauth.bin'), Buffer.from('{"accessToken":7}', 'utf8'));
    const tokenStore = new ChatGptOAuthTokenStore(tempDir, {
      isEncryptionAvailable: () => true,
      encryptString: (text: string) => Buffer.from(text, 'utf8'),
      decryptString: (buffer: Buffer) => buffer.toString('utf8')
    });

    // When
    const load = tokenStore.load();

    // Then
    await expect(load).rejects.toThrow('Encrypted ChatGPT OAuth credentials were invalid');
  });
});
