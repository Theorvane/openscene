# Browser-session authentication spike

**Status:** Secure boundary implemented in Issue #1; interactive provider login test pending
**Applies to:** private local desktop build only

## Goal

Allow the user to connect a dedicated Gemini or Grok web session without exposing cookie values to the renderer, project files, logs, MCP tools or exported media.

## Non-goals

- reading cookies from an installed browser;
- bypassing CAPTCHA, login challenges, moderation or rate limits;
- stealth/fingerprint evasion;
- unsupported provider endpoints;
- sharing sessions between machines or users;
- claiming browser automation has API-level reliability.

## Proposed boundary

```text
Renderer
  └─ typed status/actions only
       └─ preload allowlist
            └─ Electron main
                 ├─ SessionVault (safeStorage-encrypted)
                 ├─ ProviderDomainPolicy
                 ├─ IsolatedBrowserProfile
                 ├─ UserActionGate
                 └─ Provider web driver (later issue)
```

The renderer may receive:

- provider ID;
- disconnected, stored, expired or needs-user-action status;
- expiry time when known;
- `start`, `clear` and status actions.

The renderer must never receive:

- cookie names or values;
- authorization headers;
- local profile paths;
- raw page storage;
- executable paths;
- page HTML containing private account data.

## Storage proposal

Use a new main-process store built on the same `safeStorage` pattern as `credentialStore.ts` and `chatGptOAuthTokenStore.ts`.

Persist only an encrypted versioned envelope:

```text
version
providerId
allowedOrigins
createdAt
expiresAt (optional)
encrypted session payload
```

Cookie import requirements:

- explicit user action;
- preview provider/domain and expiry before import;
- reject non-HTTPS, non-allowlisted and public-suffix cookies;
- reject cookies scoped to unrelated domains;
- do not accept executable script or arbitrary browser profile archives;
- delete plaintext parse buffers as soon as the encrypted store succeeds;
- provide a one-click clear action that closes the provider context and removes the encrypted record.

## Provider origin allowlist

The first implementation accepts exact top-level origins only. Gemini permits `gemini.google.com` and `accounts.google.com`; Grok permits `grok.com`, `x.com`, `x.ai` and `accounts.x.ai`. Redirects outside that set are blocked. Cookie domains are accepted only when Chromium reports them as applicable to one of those exact HTTPS origins.

## Implemented boundary

- `src/shared/browserSession.ts` owns provider IDs, public status and origin policy.
- `src/main/browserSessionVault.ts` validates and encrypts versioned cookie records with OS `safeStorage`.
- `src/main/browserSessionService.ts` uses a non-persistent isolated Chromium partition, restores encrypted state only inside main, opens a visible manual-login window and captures only provider-applicable cookies when the window closes.
- preload exposes only provider ID, public status, start and clear; raw cookie material has no renderer type or IPC route.
- desktop Settings exposes sign-in/re-auth/clear; mobile Settings states that the lane is unavailable and keeps API-key storage in Keychain/Keystore.

`stored` deliberately means "encrypted provider-applicable cookies exist", not "the provider accepted a generation request". Authentication and download smoke tests remain required before the lane can drive jobs.

## Job behavior

Browser-backed generation still uses the existing job lifecycle:

```text
draft → disclosure → approved → queued → running
      → needs_user_action → running
      → downloading → reviewable_result
      → failed/cancelled/expired
```

DOM automation must not import a result directly into a saved timeline. It downloads to staging, records provider provenance and waits for review/import.

## Interactive acceptance checklist

Run separately for Gemini and Grok:

- login opens in a visible isolated window;
- successful login survives an app restart;
- clearing the session signs the isolated profile out;
- no session data appears in renderer DevTools, logs or a project export;
- an expired session becomes `needs_user_action`;
- CAPTCHA/login challenge stops automation and leaves the page visible;
- a generated asset can be downloaded to staging;
- manual download/import works when selectors are deliberately disabled;
- closing the app during a job leaves recoverable local status.

## Blocker

This test requires the user to complete login interactively. No account credential or cookie should be pasted into source control or a terminal transcript.
