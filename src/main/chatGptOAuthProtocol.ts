import { z } from 'zod';

const tokenResponseSchema = z.object({
  id_token: z.string().min(1).optional(),
  access_token: z.string().min(1),
  refresh_token: z.string().min(1).optional(),
  expires_in: z.number().int().positive()
}).passthrough();

const accessTokenClaimsSchema = z.object({
  chatgpt_account_id: z.string().min(1).optional(),
  'https://api.openai.com/auth': z.object({
    chatgpt_account_id: z.string().min(1)
  }).passthrough().optional(),
  organizations: z.array(z.object({ id: z.string().min(1) }).passthrough()).optional()
}).passthrough();

type TokenBundle = {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresAt: number;
  readonly accountId: string;
};

type TokenRequestInput = {
  readonly tokenEndpoint: string;
  readonly clientId: string;
  readonly parameters: URLSearchParams;
  readonly fallbackRefreshToken?: string;
  readonly fetchImpl: typeof fetch;
  readonly now: () => number;
  readonly signal: AbortSignal;
};

export class ChatGptOAuthProtocolError extends Error {
  override readonly name = 'ChatGptOAuthProtocolError';

  constructor(readonly reason: 'invalid_access_token' | 'invalid_token_response' | 'token_request_failed', message: string, options?: ErrorOptions) {
    super(message, options);
  }
}

function parseAccountId(token: string | undefined): string | null {
  if (token === undefined) {
    return null;
  }
  const segments = token.split('.');
  const payload = segments[1];
  if (segments.length !== 3 || payload === undefined) {
    return null;
  }

  try {
    const claims: unknown = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    const parsed = accessTokenClaimsSchema.parse(claims);
    return parsed.chatgpt_account_id
      ?? parsed['https://api.openai.com/auth']?.chatgpt_account_id
      ?? parsed.organizations?.[0]?.id
      ?? null;
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof z.ZodError) {
      return null;
    }
    throw error;
  }
}

function extractAccountId(idToken: string | undefined, accessToken: string): string {
  const accountId = parseAccountId(idToken) ?? parseAccountId(accessToken);
  if (accountId === null) {
    throw new ChatGptOAuthProtocolError('invalid_access_token', 'ChatGPT access token did not contain an account ID.');
  }
  return accountId;
}

async function requestTokens(input: TokenRequestInput): Promise<TokenBundle> {
  const parameters = new URLSearchParams(input.parameters);
  parameters.set('client_id', input.clientId);
  const response = await input.fetchImpl(input.tokenEndpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: parameters.toString(),
    signal: input.signal
  });
  if (!response.ok) {
    throw new ChatGptOAuthProtocolError('token_request_failed', `ChatGPT token request failed with HTTP ${response.status}.`);
  }

  let parsed: z.infer<typeof tokenResponseSchema>;
  try {
    const payload: unknown = await response.json();
    parsed = tokenResponseSchema.parse(payload);
  } catch (error) {
    throw new ChatGptOAuthProtocolError('invalid_token_response', 'ChatGPT returned an invalid token response.', { cause: error });
  }

  const refreshToken = parsed.refresh_token ?? input.fallbackRefreshToken;
  if (refreshToken === undefined) {
    throw new ChatGptOAuthProtocolError('invalid_token_response', 'ChatGPT token response did not include a refresh token.');
  }
  return {
    accessToken: parsed.access_token,
    refreshToken,
    expiresAt: input.now() + parsed.expires_in * 1_000,
    accountId: extractAccountId(parsed.id_token, parsed.access_token)
  };
}

type ExchangeAuthorizationCodeInput = {
  readonly tokenEndpoint: string;
  readonly clientId: string;
  readonly redirectUri: string;
  readonly code: string;
  readonly verifier: string;
  readonly fetchImpl: typeof fetch;
  readonly now: () => number;
  readonly signal: AbortSignal;
};

export function exchangeAuthorizationCode(input: ExchangeAuthorizationCodeInput): Promise<TokenBundle> {
  return requestTokens({
    tokenEndpoint: input.tokenEndpoint,
    clientId: input.clientId,
    parameters: new URLSearchParams({
      grant_type: 'authorization_code',
      code: input.code,
      redirect_uri: input.redirectUri,
      code_verifier: input.verifier
    }),
    fetchImpl: input.fetchImpl,
    now: input.now,
    signal: input.signal
  });
}

type RefreshTokensInput = {
  readonly tokenEndpoint: string;
  readonly clientId: string;
  readonly refreshToken: string;
  readonly fetchImpl: typeof fetch;
  readonly now: () => number;
  readonly signal: AbortSignal;
};

export function refreshTokens(input: RefreshTokensInput): Promise<TokenBundle> {
  return requestTokens({
    tokenEndpoint: input.tokenEndpoint,
    clientId: input.clientId,
    parameters: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: input.refreshToken }),
    fallbackRefreshToken: input.refreshToken,
    fetchImpl: input.fetchImpl,
    now: input.now,
    signal: input.signal
  });
}
