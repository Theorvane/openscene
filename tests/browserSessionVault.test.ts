import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { BrowserSessionVault } from '../src/main/browserSessionVault';

const encryption = {
  isEncryptionAvailable: () => true,
  encryptString: (text: string) => Buffer.from(text, 'utf8').reverse(),
  decryptString: (buffer: Buffer) => Buffer.from(buffer).reverse().toString('utf8')
};

function record(expirationDate?: number) {
  return {
    version: 1 as const,
    providerId: 'gemini' as const,
    storedAt: '2026-09-02T10:00:00.000Z',
    cookies: [{
      name: '__Secure-session',
      value: 'secret-cookie-value',
      domain: '.google.com',
      hostOnly: false,
      path: '/',
      secure: true,
      httpOnly: true,
      session: expirationDate === undefined,
      ...(expirationDate === undefined ? {} : { expirationDate }),
      sameSite: 'lax' as const,
      sourceUrl: 'https://gemini.google.com'
    }]
  };
}

describe('BrowserSessionVault', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'openvideo-browser-session-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('encrypts cookie payloads and exposes only a redacted public status', async () => {
    const vault = new BrowserSessionVault(tempDir, encryption);
    const status = await vault.save(record(1_800_000_000));

    expect(status).toEqual({
      providerId: 'gemini',
      kind: 'stored',
      origin: 'https://gemini.google.com',
      storedAt: '2026-09-02T10:00:00.000Z',
      expiresAt: '2027-01-15T08:00:00.000Z'
    });
    expect(JSON.stringify(status)).not.toContain('secret-cookie-value');
    const encrypted = await readFile(join(tempDir, 'encrypted_browser_session_gemini.bin'));
    expect(encrypted.toString('utf8')).not.toContain('secret-cookie-value');
    await expect(vault.loadSecret('gemini')).resolves.toEqual(record(1_800_000_000));
  });

  it('marks a fully expired persistent session as expired', async () => {
    const vault = new BrowserSessionVault(tempDir, encryption);
    await vault.save(record(1_700_000_000));

    await expect(vault.getStatus('gemini', new Date('2026-09-02T12:00:00.000Z'))).resolves.toMatchObject({
      providerId: 'gemini',
      kind: 'expired'
    });
  });

  it('deletes a provider session without affecting another vault slot', async () => {
    const vault = new BrowserSessionVault(tempDir, encryption);
    await vault.save(record());

    await vault.clear('grok');
    await expect(vault.getStatus('gemini')).resolves.toMatchObject({ kind: 'stored' });
    await vault.clear('gemini');
    await expect(vault.getStatus('gemini')).resolves.toEqual({
      providerId: 'gemini',
      kind: 'disconnected',
      origin: 'https://gemini.google.com'
    });
  });

  it('rejects cookie data outside the provider policy', async () => {
    const vault = new BrowserSessionVault(tempDir, encryption);
    const valid = record();
    const invalid = {
      ...valid,
      cookies: valid.cookies.map((cookie) => ({ ...cookie, domain: '.youtube.com' }))
    };

    await expect(vault.save(invalid)).rejects.toThrow('Cookie domain is not allowed');
  });

  it('fails closed when OS encryption is unavailable', async () => {
    const vault = new BrowserSessionVault(tempDir, { ...encryption, isEncryptionAvailable: () => false });
    await expect(vault.save(record())).rejects.toThrow('safeStorage encryption is unavailable');
  });
});
