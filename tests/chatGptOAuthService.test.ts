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

import {
  CHATGPT_CODEX_DEVICE_AUTH,
  ChatGptOAuthService
} from '../src/main/chatGptOAuthService';
import { ChatGptOAuthTokenStore } from '../src/main/chatGptOAuthTokenStore';

const NOW = 1_800_000_000_000;

function createJwt(payload: object): string {
  return `header.${Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')}.signature`;
}

function createDeferred<T>(): { readonly promise: Promise<T>; readonly resolve: (value: T) => void } {
  let resolvePromise: (value: T) => void = () => undefined;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}

async function eventually(expectation: () => void | Promise<void>): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      await expectation();
      return;
    } catch (error) {
      if (attempt === 19) throw error;
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }
}

describe('ChatGptOAuthService device authorization', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'openscene-codex-device-auth-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('presents a Codex device code, polls for approval, and stores the exchanged tokens', async () => {
    const accessToken = createJwt({
      'https://api.openai.com/auth': { chatgpt_account_id: 'account-123' }
    });
    let pollCount = 0;
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      if (url === CHATGPT_CODEX_DEVICE_AUTH.userCodeUrl) {
        expect(init?.method).toBe('POST');
        expect(init?.headers).toEqual({ 'content-type': 'application/json' });
        expect(JSON.parse(String(init?.body))).toEqual({ client_id: CHATGPT_CODEX_DEVICE_AUTH.clientId });
        return new Response(JSON.stringify({ device_auth_id: 'device-123', user_code: 'ABCD-EFGH', interval: '0' }), { status: 200 });
      }
      if (url === CHATGPT_CODEX_DEVICE_AUTH.tokenPollUrl) {
        expect(JSON.parse(String(init?.body))).toEqual({ device_auth_id: 'device-123', user_code: 'ABCD-EFGH' });
        pollCount += 1;
        if (pollCount === 1) return new Response('', { status: 403 });
        return new Response(JSON.stringify({
          authorization_code: 'authorization-code',
          code_verifier: 'device-code-verifier',
          code_challenge: 'unused-by-client'
        }), { status: 200 });
      }
      expect(url).toBe(CHATGPT_CODEX_DEVICE_AUTH.tokenExchangeUrl);
      const body = new URLSearchParams(String(init?.body));
      expect(body.get('grant_type')).toBe('authorization_code');
      expect(body.get('code')).toBe('authorization-code');
      expect(body.get('code_verifier')).toBe('device-code-verifier');
      expect(body.get('redirect_uri')).toBe(CHATGPT_CODEX_DEVICE_AUTH.redirectUri);
      return new Response(JSON.stringify({ access_token: accessToken, refresh_token: 'refresh-token', expires_in: 3600 }), { status: 200 });
    });
    const service = new ChatGptOAuthService(tempDir, { fetchImpl, now: () => NOW });

    await expect(service.startDeviceAuthorization()).resolves.toEqual({
      kind: 'pending',
      verificationUrl: 'https://auth.openai.com/codex/device',
      userCode: 'ABCD-EFGH'
    });
    await eventually(() => expect(pollCount).toBe(2));
    await eventually(() => expect(service.getStatus()).resolves.toEqual({ kind: 'connected' }));
    await expect(service.acquireCredentials()).resolves.toEqual({ accessToken, accountId: 'account-123' });
  });

  it.each(['cancel', 'logout'] as const)('does not persist tokens when %s wins the exchange race', async (action) => {
    const exchange = createDeferred<Response>();
    const service = new ChatGptOAuthService(tempDir, {
      fetchImpl: async (input) => {
        const url = String(input);
        if (url === CHATGPT_CODEX_DEVICE_AUTH.userCodeUrl) {
          return new Response(JSON.stringify({ device_auth_id: 'device-123', user_code: 'ABCD-EFGH', interval: '0' }), { status: 200 });
        }
        if (url === CHATGPT_CODEX_DEVICE_AUTH.tokenPollUrl) {
          return new Response(JSON.stringify({ authorization_code: 'authorization-code', code_verifier: 'device-code-verifier' }), { status: 200 });
        }
        return exchange.promise;
      },
      now: () => NOW
    });

    await service.startDeviceAuthorization();
    await eventually(() => expect(service.getStatus()).resolves.toMatchObject({ kind: 'pending' }));
    if (action === 'cancel') service.cancelAuthorization();
    else await service.logout();
    exchange.resolve(new Response(JSON.stringify({
      access_token: createJwt({ 'https://api.openai.com/auth': { chatgpt_account_id: 'account-123' } }),
      refresh_token: 'refresh-token',
      expires_in: 3600
    }), { status: 200 }));

    await eventually(() => expect(service.getStatus()).resolves.toEqual({ kind: 'disconnected' }));
  });

  it('clears a token save that was already in flight when logout began', async () => {
    const saveStarted = createDeferred<void>();
    const unblockSave = createDeferred<void>();
    const originalSave = ChatGptOAuthTokenStore.prototype.save;
    vi.spyOn(ChatGptOAuthTokenStore.prototype, 'save').mockImplementationOnce(async function (this: ChatGptOAuthTokenStore, tokens) {
      saveStarted.resolve();
      await unblockSave.promise;
      await originalSave.call(this, tokens);
    });
    const service = new ChatGptOAuthService(tempDir, {
      fetchImpl: async (input) => {
        const url = String(input);
        if (url === CHATGPT_CODEX_DEVICE_AUTH.userCodeUrl) {
          return new Response(JSON.stringify({ device_auth_id: 'device-123', user_code: 'ABCD-EFGH', interval: '0' }), { status: 200 });
        }
        if (url === CHATGPT_CODEX_DEVICE_AUTH.tokenPollUrl) {
          return new Response(JSON.stringify({ authorization_code: 'authorization-code', code_verifier: 'device-code-verifier' }), { status: 200 });
        }
        return new Response(JSON.stringify({
          access_token: createJwt({ 'https://api.openai.com/auth': { chatgpt_account_id: 'account-123' } }),
          refresh_token: 'refresh-token',
          expires_in: 3600
        }), { status: 200 });
      },
      now: () => NOW
    });

    await service.startDeviceAuthorization();
    await saveStarted.promise;
    const logout = service.logout();
    unblockSave.resolve();
    await logout;

    await expect(service.getStatus()).resolves.toEqual({ kind: 'disconnected' });
  });
});
