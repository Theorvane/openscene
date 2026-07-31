import * as Crypto from 'expo-crypto';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';

import {
  accountIdFromAccessToken,
  authorizationCodeBody,
  buildAuthorizationUrl,
  parseAuthorizationCallback,
  randomToken,
  refreshTokenBody
} from '@openvideo/shared/oauthPkce';

import { readSlot, writeSlot } from './credentials';

/**
 * Sign in to OpenAI with a ChatGPT account instead of pasting an API key.
 *
 * The desktop catches the authorization code on a loopback port. A phone cannot
 * listen on one, so the redirect is the app's own scheme and the system browser
 * hands it back — `openAuthSessionAsync` opens an ASWebAuthenticationSession on
 * iOS and a Custom Tab on Android, both of which return to the app on a matching
 * redirect and, importantly, are separate from the app so the page can use the
 * browser's existing session and the app never sees the password.
 *
 * Everything either side of that — the authorize URL, the state check, the token
 * exchange, reading the account id — is `src/shared/oauthPkce.ts`, shared with
 * the desktop's flow.
 *
 * Unverified: whether OpenAI's OAuth client accepts a custom-scheme redirect at
 * all. The client id below is the Codex CLI's, registered against a loopback
 * URL; if `openscene://` is not a registered redirect the authorize page will
 * refuse it. That cannot be checked without completing a real sign-in, which is
 * the user's to do — so the failure is reported as itself rather than dressed
 * up as something else.
 */

const OAUTH = {
  clientId: 'app_EMoamEEZ73f0CkXaXp7hrann',
  issuer: 'https://auth.openai.com',
  scope: 'openid profile email offline_access'
} as const;

const TOKEN_SLOT = 'openaiChatGptTokens';
/** Refreshed this long before expiry, so a slow request cannot land expired. */
const REFRESH_WINDOW_MS = 60_000;

type StoredTokens = {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresAt: number;
  readonly accountId: string | null;
};

export type SignInResult = { readonly ok: true } | { readonly ok: false; readonly message: string };

function redirectUri(): string {
  // `openscene://auth/callback` in a build; a dev client returns an exp:// URL,
  // which is why this is asked for rather than written down.
  return Linking.createURL('auth/callback');
}

async function challengeFor(verifier: string): Promise<string> {
  const digest = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, verifier, {
    encoding: Crypto.CryptoEncoding.BASE64
  });
  // base64url: the standard alphabet is not URL-safe and the padding is not
  // allowed in a code_challenge.
  return digest.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function signInWithChatGpt(): Promise<SignInResult> {
  const verifier = randomToken(64, (size) => Crypto.getRandomBytes(size));
  const state = randomToken(32, (size) => Crypto.getRandomBytes(size));
  const uri = redirectUri();

  const request = buildAuthorizationUrl({
    ...OAUTH,
    redirectUri: uri,
    verifier,
    challenge: await challengeFor(verifier),
    state,
    // The Codex backend rejects requests that do not identify the calling
    // client the way its CLI does.
    extra: { originator: 'codex_cli_rs' }
  });

  const outcome = await WebBrowser.openAuthSessionAsync(request.url, uri);
  if (outcome.type !== 'success') {
    return { ok: false, message: outcome.type === 'cancel' ? 'Sign-in was cancelled.' : 'Sign-in did not complete.' };
  }

  const callback = parseAuthorizationCallback(outcome.url, state);
  if (!callback.ok) return { ok: false, message: callback.message };

  return exchange(
    authorizationCodeBody({ clientId: OAUTH.clientId, redirectUri: uri, code: callback.code, verifier })
  );
}

async function exchange(body: URLSearchParams): Promise<SignInResult> {
  try {
    const response = await fetch(`${OAUTH.issuer}/oauth/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: body.toString()
    });
    if (!response.ok) {
      const detail = await response.text();
      return { ok: false, message: `OpenAI refused the sign-in (${response.status}): ${detail.slice(0, 200)}` };
    }
    const payload = (await response.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
    };
    if (typeof payload.access_token !== 'string' || typeof payload.refresh_token !== 'string') {
      return { ok: false, message: 'OpenAI returned a sign-in without the tokens to use it.' };
    }
    const tokens: StoredTokens = {
      accessToken: payload.access_token,
      refreshToken: payload.refresh_token,
      expiresAt: Date.now() + (payload.expires_in ?? 3600) * 1000,
      accountId: accountIdFromAccessToken(payload.access_token)
    };
    // Held in the keystore beside the API keys, and read back only by the code
    // that makes the request.
    await writeSlot(TOKEN_SLOT, JSON.stringify(tokens));
    return { ok: true };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'The sign-in request failed.' };
  }
}

async function stored(): Promise<StoredTokens | null> {
  const raw = await readSlot(TOKEN_SLOT);
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as StoredTokens;
  } catch {
    return null;
  }
}

export async function isSignedIn(): Promise<boolean> {
  return (await stored()) !== null;
}

export async function signOut(): Promise<void> {
  await writeSlot(TOKEN_SLOT, '');
}

/** A usable access token, refreshed if it is close to expiring. */
export async function chatGptCredentials(): Promise<{ accessToken: string; accountId: string | null } | null> {
  const tokens = await stored();
  if (tokens === null) return null;
  if (tokens.expiresAt - Date.now() > REFRESH_WINDOW_MS) {
    return { accessToken: tokens.accessToken, accountId: tokens.accountId };
  }
  const refreshed = await exchange(
    refreshTokenBody({ clientId: OAUTH.clientId, refreshToken: tokens.refreshToken, scope: OAUTH.scope })
  );
  if (!refreshed.ok) return null;
  const next = await stored();
  return next === null ? null : { accessToken: next.accessToken, accountId: next.accountId };
}
