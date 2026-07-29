import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (text: string) => Buffer.from(text, 'utf8').reverse(),
    decryptString: (buffer: Buffer) => Buffer.from(buffer).reverse().toString('utf8')
  }
}));

import { ChatGptOAuthService } from '../src/main/chatGptOAuthService';
import { ChatGptOAuthTokenStore } from '../src/main/chatGptOAuthTokenStore';

const NOW = 1_800_000_000_000;

function createJwt(payload: object): string {
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return `header.${encoded}.signature`;
}

describe('ChatGptOAuthService token refresh', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'openvideo-chatgpt-oauth-refresh-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('refreshes before expiry and preserves the prior refresh token when none is returned', async () => {
    // Given
    const tokenStore = new ChatGptOAuthTokenStore(tempDir);
    await tokenStore.save({
      accessToken: createJwt({ 'https://api.openai.com/auth': { chatgpt_account_id: 'old-account' } }),
      refreshToken: 'preserved-refresh-token',
      expiresAt: NOW + 1_000,
      accountId: 'old-account'
    });
    const fetchImpl = vi.fn<typeof fetch>(async (_input, init) => {
      const body = new URLSearchParams(typeof init?.body === 'string' ? init.body : '');
      expect(body.get('grant_type')).toBe('refresh_token');
      expect(body.get('refresh_token')).toBe('preserved-refresh-token');
      return new Response(JSON.stringify({
        id_token: createJwt({ chatgpt_account_id: 'refreshed-account' }),
        access_token: 'opaque-refreshed-access-token',
        expires_in: 3_600
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    const service = new ChatGptOAuthService(tempDir, {
      fetchImpl,
      now: () => NOW,
      openExternal: async () => undefined
    });

    // When
    const credentials = await service.acquireCredentials();

    // Then
    expect(credentials).toEqual({ accessToken: 'opaque-refreshed-access-token', accountId: 'refreshed-account' });
    await expect(tokenStore.load()).resolves.toMatchObject({ refreshToken: 'preserved-refresh-token' });
  });

  it('replaces the stored refresh token when refresh rotates it', async () => {
    // Given
    const tokenStore = new ChatGptOAuthTokenStore(tempDir);
    await tokenStore.save({
      accessToken: createJwt({ chatgpt_account_id: 'old-account' }),
      refreshToken: 'old-refresh-token',
      expiresAt: NOW + 1_000,
      accountId: 'old-account'
    });
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      access_token: createJwt({ organizations: [{ id: 'organization-account' }] }),
      refresh_token: 'rotated-refresh-token',
      expires_in: 3_600
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const service = new ChatGptOAuthService(tempDir, {
      fetchImpl,
      now: () => NOW,
      openExternal: async () => undefined
    });

    // When
    await service.acquireCredentials();

    // Then
    await expect(tokenStore.load()).resolves.toMatchObject({
      refreshToken: 'rotated-refresh-token',
      accountId: 'organization-account'
    });
  });
});
