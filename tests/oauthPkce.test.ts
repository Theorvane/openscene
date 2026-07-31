import { describe, expect, it } from 'vitest';

import {
  accountIdFromAccessToken,
  authorizationCodeBody,
  buildAuthorizationUrl,
  decodeBase64Url,
  parseAuthorizationCallback,
  randomToken
} from '../src/shared/oauthPkce';

const BASE = {
  issuer: 'https://auth.openai.com',
  clientId: 'app_test',
  redirectUri: 'openscene://auth/callback',
  scope: 'openid offline_access',
  verifier: 'v'.repeat(64),
  challenge: 'challenge-value',
  state: 'state-value'
};

describe('OAuth with PKCE, the portable half', () => {
  it('builds an authorize URL with S256 and the caller-supplied challenge', () => {
    const url = new URL(buildAuthorizationUrl(BASE).url);
    expect(url.origin + url.pathname).toBe('https://auth.openai.com/oauth/authorize');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('code_challenge')).toBe('challenge-value');
    expect(url.searchParams.get('redirect_uri')).toBe('openscene://auth/callback');
    // The verifier is the secret half and must never leave the device.
    expect(url.search).not.toContain(BASE.verifier);
  });

  it('carries provider-specific extras, which the Codex backend requires', () => {
    const url = new URL(buildAuthorizationUrl({ ...BASE, extra: { originator: 'codex_cli_rs' } }).url);
    expect(url.searchParams.get('originator')).toBe('codex_cli_rs');
  });

  it('refuses a callback whose state does not match', () => {
    // Without this check, anything that can make the app open a URL could feed
    // it a code and have the app exchange it — signing the user into an account
    // that is not theirs.
    const result = parseAuthorizationCallback('openscene://auth/callback?code=abc&state=attacker', 'state-value');
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.message).toMatch(/wrong state/);
  });

  it('accepts a matching callback and reads the code', () => {
    const result = parseAuthorizationCallback('openscene://auth/callback?code=abc123&state=state-value', 'state-value');
    expect(result).toEqual({ ok: true, code: 'abc123' });
  });

  it('reads parameters out of the fragment, which a custom scheme may use', () => {
    const result = parseAuthorizationCallback('openscene://auth/callback#code=frag&state=state-value', 'state-value');
    expect(result).toEqual({ ok: true, code: 'frag' });
  });

  it('surfaces the provider error rather than reporting a missing code', () => {
    const result = parseAuthorizationCallback(
      'openscene://auth/callback?error=access_denied&error_description=User+said+no&state=state-value',
      'state-value'
    );
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.message).toBe('User said no');
  });

  it('sends the verifier only when redeeming the code', () => {
    const body = authorizationCodeBody({
      clientId: 'app_test',
      redirectUri: 'openscene://auth/callback',
      code: 'abc',
      verifier: 'the-verifier'
    });
    expect(body.get('grant_type')).toBe('authorization_code');
    expect(body.get('code_verifier')).toBe('the-verifier');
  });

  it('decodes base64url without Buffer or atob, including non-ASCII', () => {
    // "안녕" as UTF-8, base64url encoded.
    expect(decodeBase64Url('7JWI64WV')).toBe('안녕');
    expect(decodeBase64Url(Buffer.from('{"a":1}').toString('base64url'))).toBe('{"a":1}');
  });

  it('finds the account id wherever the token happens to carry it', () => {
    const token = (claims: unknown): string =>
      `header.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.signature`;

    expect(accountIdFromAccessToken(token({ chatgpt_account_id: 'acct-1' }))).toBe('acct-1');
    expect(
      accountIdFromAccessToken(token({ 'https://api.openai.com/auth': { chatgpt_account_id: 'acct-2' } }))
    ).toBe('acct-2');
    expect(accountIdFromAccessToken(token({ organizations: [{ id: 'org-3' }] }))).toBe('org-3');
    // A token that carries none of them is not an error; the header is simply
    // omitted, and the backend falls back to the token's own account.
    expect(accountIdFromAccessToken(token({}))).toBeNull();
    expect(accountIdFromAccessToken('not-a-jwt')).toBeNull();
  });

  it('draws tokens only from unreserved characters, so nothing needs escaping', () => {
    const bytes = (size: number) => Uint8Array.from({ length: size }, (_, index) => index * 7);
    const token = randomToken(64, bytes);
    expect(token).toHaveLength(64);
    expect(token).toMatch(/^[A-Za-z0-9\-._~]+$/);
  });
});
