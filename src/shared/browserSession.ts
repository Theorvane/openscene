export const BROWSER_SESSION_PROVIDERS = ['gemini', 'grok'] as const;

export type BrowserSessionProviderId = (typeof BROWSER_SESSION_PROVIDERS)[number];

export type BrowserSessionKind = 'disconnected' | 'stored' | 'expired' | 'needs_user_action';

export interface BrowserSessionStatus {
  readonly providerId: BrowserSessionProviderId;
  readonly kind: BrowserSessionKind;
  /** The provider page the isolated sign-in window is allowed to open. */
  readonly origin: string;
  readonly storedAt?: string;
  readonly expiresAt?: string;
  readonly reason?: string;
}

export interface BrowserSessionProviderPolicy {
  readonly id: BrowserSessionProviderId;
  readonly label: string;
  readonly applicationOrigin: string;
  readonly loginUrl: string;
  readonly allowedNavigationOrigins: readonly string[];
}

const POLICIES: Readonly<Record<BrowserSessionProviderId, BrowserSessionProviderPolicy>> = {
  gemini: {
    id: 'gemini',
    label: 'Google Gemini / Veo',
    applicationOrigin: 'https://gemini.google.com',
    loginUrl: 'https://gemini.google.com/app',
    allowedNavigationOrigins: ['https://gemini.google.com', 'https://accounts.google.com']
  },
  grok: {
    id: 'grok',
    label: 'Grok / xAI',
    applicationOrigin: 'https://grok.com',
    loginUrl: 'https://grok.com',
    allowedNavigationOrigins: ['https://grok.com', 'https://x.com', 'https://x.ai', 'https://accounts.x.ai']
  }
};

export function parseBrowserSessionProviderId(value: unknown): BrowserSessionProviderId | null {
  return typeof value === 'string' && BROWSER_SESSION_PROVIDERS.includes(value as BrowserSessionProviderId)
    ? value as BrowserSessionProviderId
    : null;
}

export function getBrowserSessionProviderPolicy(providerId: BrowserSessionProviderId): BrowserSessionProviderPolicy {
  return POLICIES[providerId];
}

export function isBrowserSessionNavigationAllowed(providerId: BrowserSessionProviderId, candidateUrl: string): boolean {
  try {
    const origin = new URL(candidateUrl).origin;
    return POLICIES[providerId].allowedNavigationOrigins.includes(origin);
  } catch {
    return false;
  }
}

/**
 * A cookie is accepted only when its domain can be sent to one of the exact
 * HTTPS origins in the provider policy. This intentionally rejects unrelated
 * Google, X and xAI domains even though they share a parent domain.
 */
export function isBrowserSessionCookieDomainAllowed(providerId: BrowserSessionProviderId, cookieDomain: string): boolean {
  const normalized = cookieDomain.trim().toLowerCase().replace(/^\./, '');
  if (normalized.length === 0) return false;
  return POLICIES[providerId].allowedNavigationOrigins.some((allowedOrigin) => {
    const hostname = new URL(allowedOrigin).hostname.toLowerCase();
    return hostname === normalized || hostname.endsWith(`.${normalized}`);
  });
}
