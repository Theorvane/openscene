/**
 * The portable half of an OAuth authorization-code flow with PKCE.
 *
 * What differs between a desktop and a phone is only how the code comes back:
 * Electron listens on a loopback port, a phone catches a deep link. Everything
 * either side of that — building the authorize URL, checking the state, asking
 * for the tokens, reading the account id out of the access token — is the same
 * request against the same server, so it belongs here.
 *
 * Hashing is *not* here on purpose. PKCE needs SHA-256 and there is no portable
 * one: Node has `node:crypto`, Hermes has neither that nor a reliable
 * `crypto.subtle`. So the caller computes the challenge with whatever its
 * platform provides and passes it in, which keeps this module free of any
 * environment assumption.
 */

export type AuthorizationRequest = {
  readonly url: string;
  readonly verifier: string;
  readonly state: string;
};

export type PkceInput = {
  readonly issuer: string;
  readonly clientId: string;
  readonly redirectUri: string;
  readonly scope: string;
  /** Random, 43-128 chars of unreserved characters. */
  readonly verifier: string;
  /** base64url(SHA-256(verifier)), computed by the host. */
  readonly challenge: string;
  readonly state: string;
  /** Extra provider-specific parameters, e.g. OpenAI's originator. */
  readonly extra?: Readonly<Record<string, string>>;
};

export function buildAuthorizationUrl(input: PkceInput): AuthorizationRequest {
  const url = new URL(`${input.issuer}/oauth/authorize`);
  url.search = new URLSearchParams({
    response_type: 'code',
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    scope: input.scope,
    code_challenge: input.challenge,
    code_challenge_method: 'S256',
    state: input.state,
    ...(input.extra ?? {})
  }).toString();
  return { url: url.toString(), verifier: input.verifier, state: input.state };
}

export type CallbackResult =
  | { readonly ok: true; readonly code: string }
  | { readonly ok: false; readonly message: string };

/**
 * Reads the code out of the redirect, refusing anything that does not match the
 * state we sent.
 *
 * The state check is the whole point of the parameter: without it, anyone who
 * can make the app open a URL can feed it an authorization code of their own
 * choosing and have the app exchange it — logging the user into an account that
 * is not theirs.
 */
export function parseAuthorizationCallback(rawUrl: string, expectedState: string): CallbackResult {
  let params: URLSearchParams;
  try {
    const parsed = new URL(rawUrl);
    // A custom-scheme redirect can carry its parameters in the fragment.
    params = parsed.search.length > 1
      ? parsed.searchParams
      : new URLSearchParams(parsed.hash.replace(/^#/, ''));
  } catch {
    return { ok: false, message: 'The sign-in returned something that is not a URL.' };
  }

  const error = params.get('error');
  if (error !== null) {
    return { ok: false, message: params.get('error_description') ?? error };
  }
  if (params.get('state') !== expectedState) {
    return { ok: false, message: 'The sign-in came back with the wrong state and was refused.' };
  }
  const code = params.get('code');
  if (code === null || code.length === 0) {
    return { ok: false, message: 'The sign-in came back without a code.' };
  }
  return { ok: true, code };
}

export function authorizationCodeBody(input: {
  readonly clientId: string;
  readonly redirectUri: string;
  readonly code: string;
  readonly verifier: string;
}): URLSearchParams {
  return new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    code: input.code,
    code_verifier: input.verifier
  });
}

export function refreshTokenBody(input: {
  readonly clientId: string;
  readonly refreshToken: string;
  readonly scope: string;
}): URLSearchParams {
  return new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: input.clientId,
    refresh_token: input.refreshToken,
    scope: input.scope
  });
}

/** Decodes base64url without Buffer or atob, neither of which is portable. */
export function decodeBase64Url(value: string): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  let bits = 0;
  let accumulator = 0;
  const bytes: number[] = [];
  for (const character of value) {
    const index = alphabet.indexOf(character);
    if (index === -1) continue;
    accumulator = (accumulator << 6) | index;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((accumulator >> bits) & 0xff);
    }
  }
  // UTF-8 out of the bytes, so a non-ASCII claim is not mangled.
  let out = '';
  for (let index = 0; index < bytes.length; index += 1) {
    const byte = bytes[index] as number;
    if (byte < 0x80) {
      out += String.fromCharCode(byte);
    } else if (byte < 0xe0) {
      out += String.fromCharCode(((byte & 0x1f) << 6) | ((bytes[(index += 1)] as number) & 0x3f));
    } else {
      const second = bytes[(index += 1)] as number;
      const third = bytes[(index += 1)] as number;
      out += String.fromCharCode(((byte & 0x0f) << 12) | ((second & 0x3f) << 6) | (third & 0x3f));
    }
  }
  return out;
}

/**
 * The account id the Codex backend wants in a header, read from the access
 * token's own claims. The token is not verified here — it came over TLS from
 * the issuer we asked, and this only reads a routing value out of it.
 */
export function accountIdFromAccessToken(token: string): string | null {
  const payload = token.split('.')[1];
  if (payload === undefined) return null;
  try {
    const claims = JSON.parse(decodeBase64Url(payload)) as {
      chatgpt_account_id?: string;
      'https://api.openai.com/auth'?: { chatgpt_account_id?: string };
      organizations?: readonly { id?: string }[];
    };
    return (
      claims.chatgpt_account_id ??
      claims['https://api.openai.com/auth']?.chatgpt_account_id ??
      claims.organizations?.[0]?.id ??
      null
    );
  } catch {
    return null;
  }
}

/** A random string of unreserved characters, for the verifier and the state. */
export function randomToken(length: number, randomBytes: (size: number) => Uint8Array): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
  const bytes = randomBytes(length);
  let out = '';
  for (const byte of bytes) out += alphabet[byte % alphabet.length];
  return out;
}
