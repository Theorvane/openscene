import { createHash, randomBytes as nodeRandomBytes } from 'node:crypto';

import { ChatGptOAuthTokenStore } from './chatGptOAuthTokenStore';
import { receiveAuthorizationCode } from './chatGptOAuthCallback';
import { exchangeAuthorizationCode, refreshTokens } from './chatGptOAuthProtocol';
import type { ChatGptOAuthStatus } from '../shared/openAiAuth';

const CHATGPT_OAUTH = {
  clientId: 'app_EMoamEEZ73f0CkXaXp7hrann',
  issuer: 'https://auth.openai.com',
  redirectUri: 'http://127.0.0.1:19876/auth/callback',
  scope: 'openid profile email offline_access'
} as const;

export const CHATGPT_CODEX_ENDPOINT_METADATA = {
  baseUrl: 'https://chatgpt.com/backend-api/codex',
  responsesUrl: 'https://chatgpt.com/backend-api/codex/responses',
  accountIdHeader: 'ChatGPT-Account-Id'
} as const;

const AUTHORIZATION_TIMEOUT_MS = 5 * 60 * 1_000;
const REFRESH_WINDOW_MS = 5 * 60 * 1_000;

type ChatGptCodexCredentials = {
  readonly accessToken: string;
  readonly accountId: string;
};

export type ChatGptOAuthServiceDependencies = {
  readonly fetchImpl?: typeof fetch;
  readonly now?: () => number;
  readonly randomBytes?: (size: number) => Buffer;
  readonly openExternal: (url: string) => Promise<void>;
  readonly authorizationTimeoutMs?: number;
};

export class ChatGptOAuthServiceError extends Error {
  override readonly name = 'ChatGptOAuthServiceError';

  constructor(readonly reason: 'authorization_in_progress' | 'not_authenticated', message: string) {
    super(message);
  }
}

type AuthorizationRequest = {
  readonly url: string;
  readonly verifier: string;
  readonly state: string;
};

export class ChatGptOAuthService {
  private readonly tokenStore: ChatGptOAuthTokenStore;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly randomBytes: (size: number) => Buffer;
  private readonly openExternal: (url: string) => Promise<void>;
  private readonly authorizationTimeoutMs: number;
  private activeAuthorization: AbortController | null = null;

  constructor(directory: string, dependencies: ChatGptOAuthServiceDependencies) {
    this.tokenStore = new ChatGptOAuthTokenStore(directory);
    this.fetchImpl = dependencies.fetchImpl ?? fetch;
    this.now = dependencies.now ?? Date.now;
    this.randomBytes = dependencies.randomBytes ?? nodeRandomBytes;
    this.openExternal = dependencies.openExternal;
    this.authorizationTimeoutMs = dependencies.authorizationTimeoutMs ?? AUTHORIZATION_TIMEOUT_MS;
  }

  async getStatus(): Promise<ChatGptOAuthStatus> {
    const tokens = await this.tokenStore.load();
    return tokens === null ? { kind: 'disconnected' } : { kind: 'connected' };
  }

  async authorize(signal?: AbortSignal): Promise<ChatGptOAuthStatus> {
    if (this.activeAuthorization !== null) {
      throw new ChatGptOAuthServiceError('authorization_in_progress', 'ChatGPT authorization is already in progress.');
    }

    const controller = new AbortController();
    this.activeAuthorization = controller;
    const cancel = (): void => controller.abort();
    signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted === true) {
      controller.abort();
    }

    try {
      const authorization = this.createAuthorizationRequest();
      const code = await receiveAuthorizationCode({
        redirectUri: CHATGPT_OAUTH.redirectUri,
        expectedState: authorization.state,
        authorizationUrl: authorization.url,
        timeoutMs: this.authorizationTimeoutMs,
        signal: controller.signal,
        openExternal: this.openExternal
      });
      const tokens = await exchangeAuthorizationCode({
        tokenEndpoint: `${CHATGPT_OAUTH.issuer}/oauth/token`,
        clientId: CHATGPT_OAUTH.clientId,
        redirectUri: CHATGPT_OAUTH.redirectUri,
        code,
        verifier: authorization.verifier,
        fetchImpl: this.fetchImpl,
        now: this.now,
        signal: controller.signal
      });
      await this.tokenStore.save(tokens);
      return { kind: 'connected' };
    } finally {
      signal?.removeEventListener('abort', cancel);
      this.activeAuthorization = null;
    }
  }

  cancelAuthorization(): void {
    this.activeAuthorization?.abort();
  }

  async acquireCredentials(): Promise<ChatGptCodexCredentials> {
    const stored = await this.tokenStore.load();
    if (stored === null) {
      throw new ChatGptOAuthServiceError('not_authenticated', 'ChatGPT is not connected.');
    }

    const tokens = stored.expiresAt - this.now() <= REFRESH_WINDOW_MS
      ? await refreshTokens({
          tokenEndpoint: `${CHATGPT_OAUTH.issuer}/oauth/token`,
          clientId: CHATGPT_OAUTH.clientId,
          refreshToken: stored.refreshToken,
          fetchImpl: this.fetchImpl,
          now: this.now,
          signal: AbortSignal.timeout(30_000)
        })
      : stored;
    if (tokens !== stored) {
      await this.tokenStore.save(tokens);
    }
    return { accessToken: tokens.accessToken, accountId: tokens.accountId };
  }

  async logout(): Promise<ChatGptOAuthStatus> {
    this.cancelAuthorization();
    await this.tokenStore.clear();
    return { kind: 'disconnected' };
  }

  private createAuthorizationRequest(): AuthorizationRequest {
    const verifier = this.randomBytes(32).toString('base64url');
    const state = this.randomBytes(32).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const url = new URL(`${CHATGPT_OAUTH.issuer}/oauth/authorize`);
    url.search = new URLSearchParams({
      response_type: 'code',
      client_id: CHATGPT_OAUTH.clientId,
      redirect_uri: CHATGPT_OAUTH.redirectUri,
      scope: CHATGPT_OAUTH.scope,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      state,
      id_token_add_organizations: 'true',
      codex_cli_simplified_flow: 'true',
      originator: 'opencode'
    }).toString();
    return { url: url.toString(), verifier, state };
  }
}
