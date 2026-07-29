import { createHash } from 'node:crypto';
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

import { CHATGPT_CODEX_ENDPOINT_METADATA, CHATGPT_OAUTH_REDIRECT_URI, ChatGptOAuthService } from '../src/main/chatGptOAuthService';
import { ChatGptOAuthTokenStore } from '../src/main/chatGptOAuthTokenStore';
import { CredentialStore } from '../src/main/credentialStore';

const NOW = 1_800_000_000_000;

function createJwt(payload: object): string {
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return `header.${encoded}.signature`;
}

function createDeferred(): { readonly promise: Promise<void>; readonly resolve: () => void } {
  let resolvePromise = (): void => undefined;
  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}

describe('ChatGptOAuthService', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'openvideo-chatgpt-oauth-service-'));
  });

  afterEach(async () => {
    vi.useRealTimers();
    await rm(tempDir, { recursive: true, force: true });
  });

  it('authorizes with PKCE and persists the exchanged account credentials', async () => {
    // Given
    const verifierBytes = Buffer.alloc(32, 7);
    const stateBytes = Buffer.alloc(32, 9);
    const randomBytes = vi.fn<(size: number) => Buffer>()
      .mockReturnValueOnce(verifierBytes)
      .mockReturnValueOnce(stateBytes);
    let authorizationUrl: URL | undefined;
    const openExternal = vi.fn(async (target: string) => {
      authorizationUrl = new URL(target);
      const state = authorizationUrl.searchParams.get('state');
      if (state === null) {
        throw new Error('Authorization URL did not contain state.');
      }
      const callback = new URL(CHATGPT_OAUTH_REDIRECT_URI);
      callback.searchParams.set('code', 'authorization-code');
      callback.searchParams.set('state', state);
      const response = await fetch(callback);
      expect(response.status).toBe(200);
    });
    const accessToken = createJwt({
      'https://api.openai.com/auth': { chatgpt_account_id: 'account-123' }
    });
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      expect(String(input)).toBe('https://auth.openai.com/oauth/token');
      expect(init?.method).toBe('POST');
      const body = new URLSearchParams(typeof init?.body === 'string' ? init.body : '');
      expect(body.get('grant_type')).toBe('authorization_code');
      expect(body.get('code')).toBe('authorization-code');
      expect(body.get('code_verifier')).toBe(verifierBytes.toString('base64url'));
      return new Response(JSON.stringify({
        access_token: accessToken,
        refresh_token: 'refresh-token',
        expires_in: 3_600
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    const service = new ChatGptOAuthService(tempDir, {
      fetchImpl,
      now: () => NOW,
      randomBytes,
      openExternal
    });

    // When
    const status = await service.authorize();

    // Then
    expect(status).toEqual({ kind: 'connected' });
    expect(openExternal).toHaveBeenCalledTimes(1);
    expect(authorizationUrl?.origin).toBe('https://auth.openai.com');
    expect(authorizationUrl?.pathname).toBe('/oauth/authorize');
    expect(authorizationUrl?.searchParams.get('client_id')).toBe('app_EMoamEEZ73f0CkXaXp7hrann');
    expect(authorizationUrl?.searchParams.get('redirect_uri')).toBe(CHATGPT_OAUTH_REDIRECT_URI);
    expect(authorizationUrl?.searchParams.get('code_challenge_method')).toBe('S256');
    expect(authorizationUrl?.searchParams.get('code_challenge')).toBe(
      createHash('sha256').update(verifierBytes.toString('base64url')).digest('base64url')
    );
    expect(CHATGPT_CODEX_ENDPOINT_METADATA).toEqual({
      baseUrl: 'https://chatgpt.com/backend-api/codex',
      responsesUrl: 'https://chatgpt.com/backend-api/codex/responses',
      accountIdHeader: 'ChatGPT-Account-Id'
    });
    await expect(service.getStatus()).resolves.toEqual({ kind: 'connected' });
    await expect(service.acquireCredentials()).resolves.toEqual({ accessToken, accountId: 'account-123' });
    const replay = new URL(CHATGPT_OAUTH_REDIRECT_URI);
    replay.searchParams.set('code', 'authorization-code');
    replay.searchParams.set('state', stateBytes.toString('base64url'));
    await expect(fetch(replay)).rejects.toThrow();
  });

  it('reports disconnected before authorization', async () => {
    // Given
    const service = new ChatGptOAuthService(tempDir, { openExternal: async () => undefined });

    // When
    const status = await service.getStatus();

    // Then
    expect(status).toEqual({ kind: 'disconnected' });
  });

  it('logs out OAuth without removing the OpenAI API key', async () => {
    // Given
    const credentialStore = new CredentialStore(tempDir);
    await credentialStore.setCredential('openaiApiKey', 'sk-api-key-remains');
    const tokenStore = new ChatGptOAuthTokenStore(tempDir);
    await tokenStore.save({
      accessToken: createJwt({ chatgpt_account_id: 'account-123' }),
      refreshToken: 'refresh-token',
      expiresAt: NOW + 3_600_000,
      accountId: 'account-123'
    });
    const service = new ChatGptOAuthService(tempDir, { openExternal: async () => undefined });

    // When
    const status = await service.logout();

    // Then
    expect(status).toEqual({ kind: 'disconnected' });
    await expect(service.getStatus()).resolves.toEqual({ kind: 'disconnected' });
    await expect(credentialStore.getCredentialValue('openaiApiKey')).resolves.toBe('sk-api-key-remains');
  });

  it('rejects a concurrent authorization attempt', async () => {
    // Given
    const opened = createDeferred();
    const service = new ChatGptOAuthService(tempDir, {
      openExternal: async () => opened.resolve()
    });
    const firstAuthorization = service.authorize();
    await opened.promise;

    // When
    const secondAuthorization = service.authorize();

    // Then
    await expect(secondAuthorization).rejects.toMatchObject({ reason: 'authorization_in_progress' });
    service.cancelAuthorization();
    await expect(firstAuthorization).rejects.toMatchObject({ reason: 'cancelled' });
  });

  it('external abort cancels authorization and closes the callback server', async () => {
    // Given
    const opened = createDeferred();
    const controller = new AbortController();
    const service = new ChatGptOAuthService(tempDir, {
      openExternal: async () => opened.resolve()
    });
    const authorization = service.authorize(controller.signal);
    await opened.promise;

    // When
    controller.abort();

    // Then
    await expect(authorization).rejects.toMatchObject({ reason: 'cancelled' });
    await expect(fetch(CHATGPT_OAUTH_REDIRECT_URI, {
      signal: AbortSignal.timeout(250)
    })).rejects.toThrow();
  });

  it('rejects a callback whose state does not match', async () => {
    // Given
    let callbackStatus: number | undefined;
    const callbackHandled = createDeferred();
    const service = new ChatGptOAuthService(tempDir, {
      fetchImpl: async () => {
        throw new Error('Token exchange must not run for invalid state.');
      },
      openExternal: async () => {
        const callback = new URL(CHATGPT_OAUTH_REDIRECT_URI);
        callback.searchParams.set('code', 'authorization-code');
        callback.searchParams.set('state', 'wrong-state');
        callbackStatus = (await fetch(callback)).status;
        callbackHandled.resolve();
      }
    });

    // When
    const authorization = service.authorize();

    // Then
    await expect(authorization).rejects.toMatchObject({ reason: 'invalid_state' });
    await callbackHandled.promise;
    expect(callbackStatus).toBe(400);
    await expect(fetch(CHATGPT_OAUTH_REDIRECT_URI)).rejects.toThrow();
  });

  it('times out authorization and closes the callback server', async () => {
    // Given
    vi.useFakeTimers();
    const opened = createDeferred();
    const service = new ChatGptOAuthService(tempDir, {
      authorizationTimeoutMs: 10,
      openExternal: async () => opened.resolve()
    });
    const authorization = service.authorize();
    const rejection = expect(authorization).rejects.toMatchObject({ reason: 'timed_out' });
    await opened.promise;

    // When
    await vi.advanceTimersByTimeAsync(10);

    // Then
    await rejection;
    vi.useRealTimers();
    await expect(fetch(CHATGPT_OAUTH_REDIRECT_URI)).rejects.toThrow();
  });

  it('handles browser cancellation and closes the callback server', async () => {
    // Given
    vi.useFakeTimers();
    let cancelStatus: number | undefined;
    const cancelHandled = createDeferred();
    const service = new ChatGptOAuthService(tempDir, {
      authorizationTimeoutMs: 10,
      openExternal: async () => {
        cancelStatus = (await fetch(new URL('/cancel', CHATGPT_OAUTH_REDIRECT_URI).toString())).status;
        cancelHandled.resolve();
      }
    });
    const authorization = service.authorize();
    const rejection = expect(authorization).rejects.toMatchObject({ reason: 'cancelled' });
    await cancelHandled.promise;

    // When
    await vi.advanceTimersByTimeAsync(10);

    // Then
    await rejection;
    expect(cancelStatus).toBe(200);
    vi.useRealTimers();
    await expect(fetch(CHATGPT_OAUTH_REDIRECT_URI)).rejects.toThrow();
  });
});
