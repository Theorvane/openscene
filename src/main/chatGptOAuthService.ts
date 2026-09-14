import { ChatGptOAuthTokenStore } from './chatGptOAuthTokenStore';
import { exchangeAuthorizationCode, refreshTokens } from './chatGptOAuthProtocol';
import type { ChatGptOAuthStatus } from '../shared/openAiAuth';

export const CHATGPT_CODEX_DEVICE_AUTH = {
  clientId: 'app_EMoamEEZ73f0CkXaXp7hrann',
  userCodeUrl: 'https://auth.openai.com/api/accounts/deviceauth/usercode',
  tokenPollUrl: 'https://auth.openai.com/api/accounts/deviceauth/token',
  tokenExchangeUrl: 'https://auth.openai.com/oauth/token',
  verificationUrl: 'https://auth.openai.com/codex/device',
  redirectUri: 'https://auth.openai.com/deviceauth/callback'
} as const;

export const CHATGPT_CODEX_ENDPOINT_METADATA = {
  baseUrl: 'https://chatgpt.com/backend-api/codex',
  responsesUrl: 'https://chatgpt.com/backend-api/codex/responses',
  accountIdHeader: 'ChatGPT-Account-Id'
} as const;

export const CHATGPT_CLIENT_ORIGINATOR = 'openvideo';

export function chatGptCodexClientHeaders(sessionId: string): Readonly<Record<string, string>> {
  return {
    originator: CHATGPT_CLIENT_ORIGINATOR,
    'User-Agent': `${CHATGPT_CLIENT_ORIGINATOR}/0.0.0`,
    'session-id': sessionId
  };
}

const REFRESH_WINDOW_MS = 5 * 60 * 1_000;
const DEVICE_AUTH_TIMEOUT_MS = 15 * 60 * 1_000;

type ChatGptCodexCredentials = {
  readonly accessToken: string;
  readonly accountId: string;
};

type UserCodeResponse = {
  readonly device_auth_id: string;
  readonly user_code?: string;
  readonly usercode?: string;
  readonly interval?: string | number;
};

type DeviceTokenResponse = {
  readonly authorization_code: string;
  readonly code_verifier: string;
};

export type ChatGptOAuthServiceDependencies = {
  readonly fetchImpl?: typeof fetch;
  readonly now?: () => number;
};

export class ChatGptOAuthServiceError extends Error {
  override readonly name = 'ChatGptOAuthServiceError';

  constructor(readonly reason: 'authorization_in_progress' | 'not_authenticated' | 'device_authorization_failed', message: string, options?: ErrorOptions) {
    super(message, options);
  }
}

function intervalMs(value: string | number | undefined): number {
  const seconds = typeof value === 'number' ? value : Number.parseInt(value ?? '', 10);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1_000 : 5_000;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new DOMException('The operation was aborted.', 'AbortError'));
    }, { once: true });
  });
}

export class ChatGptOAuthService {
  private readonly tokenStore: ChatGptOAuthTokenStore;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private activeAuthorization: AbortController | null = null;
  private activeStatus: ChatGptOAuthStatus | null = null;
  private credentialOperation: Promise<void> = Promise.resolve();

  constructor(directory: string, dependencies: ChatGptOAuthServiceDependencies = {}) {
    this.tokenStore = new ChatGptOAuthTokenStore(directory);
    this.fetchImpl = dependencies.fetchImpl ?? fetch;
    this.now = dependencies.now ?? Date.now;
  }

  async getStatus(): Promise<ChatGptOAuthStatus> {
    if (this.activeStatus !== null) return this.activeStatus;
    const tokens = await this.tokenStore.load();
    return tokens === null ? { kind: 'disconnected' } : { kind: 'connected' };
  }

  async startDeviceAuthorization(): Promise<ChatGptOAuthStatus> {
    if (this.activeAuthorization !== null) {
      throw new ChatGptOAuthServiceError('authorization_in_progress', 'Codex device authorization is already in progress.');
    }
    const controller = new AbortController();
    this.activeAuthorization = controller;
    try {
      const response = await this.fetchImpl(CHATGPT_CODEX_DEVICE_AUTH.userCodeUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ client_id: CHATGPT_CODEX_DEVICE_AUTH.clientId }),
        signal: controller.signal
      });
      if (!response.ok) throw new ChatGptOAuthServiceError('device_authorization_failed', `Codex device code request failed with HTTP ${response.status}.`);
      const payload = await response.json() as UserCodeResponse;
      const userCode = payload.user_code ?? payload.usercode;
      if (typeof payload.device_auth_id !== 'string' || payload.device_auth_id.length === 0 || typeof userCode !== 'string' || userCode.length === 0) {
        throw new ChatGptOAuthServiceError('device_authorization_failed', 'Codex returned an invalid device code response.');
      }
      const pending: ChatGptOAuthStatus = {
        kind: 'pending',
        verificationUrl: CHATGPT_CODEX_DEVICE_AUTH.verificationUrl,
        userCode
      };
      this.activeStatus = pending;
      void this.completeDeviceAuthorization({ deviceAuthId: payload.device_auth_id, userCode, interval: intervalMs(payload.interval) }, controller)
        .catch(() => undefined)
        .finally(() => {
          if (this.activeAuthorization === controller) {
            this.activeAuthorization = null;
            this.activeStatus = null;
          }
        });
      return pending;
    } catch (error) {
      if (this.activeAuthorization === controller) this.activeAuthorization = null;
      throw error;
    }
  }

  cancelAuthorization(): void {
    this.activeAuthorization?.abort();
  }

  async acquireCredentials(): Promise<ChatGptCodexCredentials> {
    const stored = await this.tokenStore.load();
    if (stored === null) throw new ChatGptOAuthServiceError('not_authenticated', 'Codex is not connected.');
    const tokens = stored.expiresAt - this.now() <= REFRESH_WINDOW_MS
      ? await refreshTokens({
          tokenEndpoint: CHATGPT_CODEX_DEVICE_AUTH.tokenExchangeUrl,
          clientId: CHATGPT_CODEX_DEVICE_AUTH.clientId,
          refreshToken: stored.refreshToken,
          fetchImpl: this.fetchImpl,
          now: this.now,
          signal: AbortSignal.timeout(30_000)
        })
      : stored;
    if (tokens !== stored) await this.serializeCredentialOperation(() => this.tokenStore.save(tokens));
    return { accessToken: tokens.accessToken, accountId: tokens.accountId };
  }

  async logout(): Promise<ChatGptOAuthStatus> {
    this.cancelAuthorization();
    await this.serializeCredentialOperation(() => this.tokenStore.clear());
    return { kind: 'disconnected' };
  }

  private serializeCredentialOperation(action: () => Promise<void>): Promise<void> {
    const next = this.credentialOperation.then(action, action);
    this.credentialOperation = next.catch(() => undefined);
    return next;
  }

  private async completeDeviceAuthorization(device: { readonly deviceAuthId: string; readonly userCode: string; readonly interval: number }, controller: AbortController): Promise<void> {
    const deadline = this.now() + DEVICE_AUTH_TIMEOUT_MS;
    while (this.now() < deadline) {
      const response = await this.fetchImpl(CHATGPT_CODEX_DEVICE_AUTH.tokenPollUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ device_auth_id: device.deviceAuthId, user_code: device.userCode }),
        signal: controller.signal
      });
      if (response.ok) {
        const payload = await response.json() as DeviceTokenResponse;
        if (typeof payload.authorization_code !== 'string' || typeof payload.code_verifier !== 'string') {
          throw new ChatGptOAuthServiceError('device_authorization_failed', 'Codex returned an invalid device authorization result.');
        }
        const tokens = await exchangeAuthorizationCode({
          tokenEndpoint: CHATGPT_CODEX_DEVICE_AUTH.tokenExchangeUrl,
          clientId: CHATGPT_CODEX_DEVICE_AUTH.clientId,
          redirectUri: CHATGPT_CODEX_DEVICE_AUTH.redirectUri,
          code: payload.authorization_code,
          verifier: payload.code_verifier,
          fetchImpl: this.fetchImpl,
          now: this.now,
          signal: controller.signal
        });
        await this.serializeCredentialOperation(async () => {
          if (controller.signal.aborted || this.activeAuthorization !== controller) {
            throw new DOMException('The operation was aborted.', 'AbortError');
          }
          await this.tokenStore.save(tokens);
        });
        return;
      }
      if (response.status !== 403 && response.status !== 404) {
        throw new ChatGptOAuthServiceError('device_authorization_failed', `Codex device authorization failed with HTTP ${response.status}.`);
      }
      await sleep(Math.min(device.interval, Math.max(0, deadline - this.now())), controller.signal);
    }
    throw new ChatGptOAuthServiceError('device_authorization_failed', 'Codex device authorization timed out.');
  }
}
