import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CredentialStore } from '../src/main/credentialStore';

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (text: string) => Buffer.from(text, 'utf8'),
    decryptString: (buffer: Buffer) => buffer.toString('utf8')
  }
}));

describe('CredentialStore safeStorage and secret boundary tests', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'openvideo-credentials-test-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('stores and retrieves provider API key status without exposing plaintext secrets to UI status map', async () => {
    const store = new CredentialStore(tempDir);
    await store.setCredential('openaiApiKey', 'sk-proj-test123456');
    await store.setCredential('anthropicApiKey', 'sk-ant-test654321');
    await store.setCredential('elevenlabsApiKey', 'sk-eleven-test123999');

    const status = await store.getCredentialStatus();
    expect(status.openaiApiKey).toBe(true);
    expect(status.anthropicApiKey).toBe(true);
    expect(status.elevenlabsApiKey).toBe(true);
    expect(status.geminiApiKey).toBe(false);
    expect(status.deepseekApiKey).toBe(false);

    const val = await store.getCredentialValue('openaiApiKey');
    expect(val).toBe('sk-proj-test123456');

    const elevenVal = await store.getCredentialValue('elevenlabsApiKey');
    expect(elevenVal).toBe('sk-eleven-test123999');
  });

  it('handles empty credential store initialization gracefully', async () => {
    const store = new CredentialStore(tempDir);
    const status = await store.getCredentialStatus();
    expect(status.openaiApiKey).toBe(false);
  });

  it('fails closed when safeStorage encryption is unavailable rather than writing plaintext', async () => {
    const electron = await import('electron');
    vi.spyOn(electron.safeStorage, 'isEncryptionAvailable').mockReturnValue(false);

    const store = new CredentialStore(tempDir);
    await expect(store.setCredential('openaiApiKey', 'sk-should-not-be-written')).rejects.toThrow(
      'safeStorage encryption is unavailable'
    );

    vi.restoreAllMocks();
  });
});
