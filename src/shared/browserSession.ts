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
  /** Origins accepted only for decrypting sessions saved by older builds. */
  readonly compatibleCookieSourceOrigins?: readonly string[];
}

export type GoogleFlowImagePromptInput = {
  readonly prompt: string;
  readonly aspectRatio: string;
  readonly stylePreset?: string;
  readonly negativePrompt?: string;
};

const MAX_GOOGLE_FLOW_PROJECT_NAME_LENGTH = 100;

/**
 * Keep the local folder/project label usable as a Flow project title without
 * leaking paths or control characters into the provider UI.
 */
export function normalizeGoogleFlowProjectName(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const normalized = value
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_GOOGLE_FLOW_PROJECT_NAME_LENGTH)
    .trim();
  return normalized.length === 0 ? undefined : normalized;
}

export type GoogleFlowImageModel = 'nano-banana-2' | 'nano-banana-pro';

export type GoogleFlowVideoModel =
  | 'omni-1.1-flash'
  | 'veo-3.1-lite'
  | 'veo-3.1-fast'
  | 'veo-3.1-quality';

export type GoogleFlowVideoPromptInput = {
  readonly prompt: string;
  readonly aspectRatio: string;
  readonly durationSeconds: number;
  readonly stylePreset?: string;
};

export const GOOGLE_FLOW_PREFERENCES_STORAGE_KEY = 'openvideo-google-flow-preferences-v1';

export type GoogleFlowPreferences = {
  readonly schemaVersion: 1;
  readonly showWindowDuringGeneration: boolean;
};

export const DEFAULT_GOOGLE_FLOW_PREFERENCES: GoogleFlowPreferences = {
  schemaVersion: 1,
  // Visible by default while the Flow integration is experimental, so UI
  // changes, account prompts, and generation progress remain observable.
  showWindowDuringGeneration: true
};

export function parseGoogleFlowPreferences(raw: string | null): GoogleFlowPreferences {
  if (raw === null) return DEFAULT_GOOGLE_FLOW_PREFERENCES;
  try {
    const value = JSON.parse(raw) as { schemaVersion?: unknown; showWindowDuringGeneration?: unknown };
    if (value.schemaVersion !== 1 || typeof value.showWindowDuringGeneration !== 'boolean') {
      return DEFAULT_GOOGLE_FLOW_PREFERENCES;
    }
    return { schemaVersion: 1, showWindowDuringGeneration: value.showWindowDuringGeneration };
  } catch {
    return DEFAULT_GOOGLE_FLOW_PREFERENCES;
  }
}

export function serializeGoogleFlowPreferences(preferences: GoogleFlowPreferences): string {
  return JSON.stringify({
    schemaVersion: 1,
    showWindowDuringGeneration: preferences.showWindowDuringGeneration
  });
}

/** Map API catalog choices onto the image models exposed by Google Flow. */
export function googleFlowImageModelFor(modelId: string): GoogleFlowImageModel {
  if (modelId.includes('pro')) return 'nano-banana-pro';
  // Flow does not expose a separate Flash-Lite image tier. Both Flash catalog
  // entries use the current Nano Banana 2 option in the signed-in Flow UI.
  return 'nano-banana-2';
}

/** Map only catalog choices that have an exact counterpart in the live Flow UI. */
export function googleFlowVideoModelFor(modelId: string): GoogleFlowVideoModel | null {
  if (modelId === 'gemini-omni-1.1-flash') return 'omni-1.1-flash';
  if (modelId === 'veo-3.1-generate-preview') return 'veo-3.1-quality';
  if (modelId === 'veo-3.1-fast-generate-preview') return 'veo-3.1-fast';
  if (modelId === 'veo-3.1-lite-generate-preview') return 'veo-3.1-lite';
  return null;
}

export function googleFlowVideoModelLabel(model: GoogleFlowVideoModel): string {
  if (model === 'omni-1.1-flash') return 'Omni 1.1 Flash';
  if (model === 'veo-3.1-lite') return 'Veo 3.1 - Lite';
  if (model === 'veo-3.1-fast') return 'Veo 3.1 - Fast';
  return 'Veo 3.1 - Quality';
}

export function googleFlowVideoDurationOptions(model: GoogleFlowVideoModel): readonly number[] {
  return model === 'omni-1.1-flash' ? [4, 6, 8, 10] : [8];
}

export function buildGoogleFlowVideoPrompt(input: GoogleFlowVideoPromptInput): string {
  const lines = [
    'Create one video (do not answer with only text).',
    input.prompt.trim(),
    `Use a ${input.aspectRatio} aspect ratio and ${input.durationSeconds} second duration.`
  ];
  const style = input.stylePreset?.trim();
  if (style) lines.push(`Visual style: ${style}.`);
  return lines.join('\n');
}

/**
 * Flow exposes only coarse orientation controls. Preserve the exact requested
 * ratio as prompt text so square and non-16:9 requests are not silently lost.
 */
export function buildGoogleFlowImagePrompt(input: GoogleFlowImagePromptInput): string {
  const lines = [
    'Create one image (do not answer with only text).',
    input.prompt.trim(),
    `Use a ${input.aspectRatio} aspect ratio.`
  ];
  const style = input.stylePreset?.trim();
  if (style) lines.push(`Visual style: ${style}.`);
  const avoid = input.negativePrompt?.trim();
  if (avoid) lines.push(`Do not include: ${avoid}.`);
  return lines.join('\n');
}

const POLICIES: Readonly<Record<BrowserSessionProviderId, BrowserSessionProviderPolicy>> = {
  gemini: {
    id: 'gemini',
    label: 'Google Labs Flow / Veo',
    applicationOrigin: 'https://flow.google.com',
    loginUrl: 'https://flow.google.com/',
    // The persisted provider id remains `gemini` for compatibility, but this
    // media lane permits only Flow and Google's own sign-in origin.
    // Flow currently redirects its public labs entry point to the dedicated
    // flow.google.com application before rendering the project list/editor.
    // Keep the exact origin allowlist; do not widen this to *.google.com.
    allowedNavigationOrigins: ['https://flow.google.com', 'https://labs.google', 'https://accounts.google.com'],
    compatibleCookieSourceOrigins: ['https://gemini.google.com']
  },
  grok: {
    id: 'grok',
    label: 'Grok / xAI',
    applicationOrigin: 'https://grok.com',
    // Start at xAI's account surface rather than relying on grok.com to
    // discover and redirect to the current sign-in flow.
    loginUrl: 'https://accounts.x.ai/sign-in?redirect=grok-com',
    // Keep these exact. xAI currently hands the account challenge through
    // auth.grok.com, its isolated auth.grokusercontent.com renderer, and the
    // shared auth.grokipedia.com cookie setter before returning to Grok.
    // Omitting an authentication origin leaves the submit button spinning
    // while the main-frame navigation guard cancels the callback.
    allowedNavigationOrigins: [
      'https://grok.com',
      'https://x.com',
      'https://x.ai',
      'https://accounts.x.ai',
      'https://auth.x.ai',
      'https://auth.grok.com',
      'https://auth.grokusercontent.com',
      'https://auth.grokipedia.com'
    ]
  }
};

/** Reduce a URL to a non-sensitive origin suitable for browser-session logs. */
export function browserSessionDiagnosticTarget(candidateUrl: string): string {
  try {
    const parsed = new URL(candidateUrl);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return `${parsed.protocol}//opaque`;
    }
    return parsed.origin;
  } catch {
    return 'invalid-url';
  }
}

/** Keep only Chromium's stable error token; never log provider response text. */
export function browserSessionDiagnosticError(value: unknown): string {
  const match = String(value ?? '').toUpperCase().match(/\bERR_[A-Z0-9_]+\b/);
  return match?.[0] ?? 'NETWORK_ERROR';
}

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

export function isBrowserSessionCookieSourceAllowed(providerId: BrowserSessionProviderId, candidateUrl: string): boolean {
  try {
    const origin = new URL(candidateUrl).origin;
    const policy = POLICIES[providerId];
    return policy.allowedNavigationOrigins.includes(origin)
      || policy.compatibleCookieSourceOrigins?.includes(origin) === true;
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
  const policy = POLICIES[providerId];
  const cookieOrigins = [...policy.allowedNavigationOrigins, ...(policy.compatibleCookieSourceOrigins ?? [])];
  return cookieOrigins.some((allowedOrigin) => {
    const hostname = new URL(allowedOrigin).hostname.toLowerCase();
    return hostname === normalized || hostname.endsWith(`.${normalized}`);
  });
}
