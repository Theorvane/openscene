import { BrowserWindow, session, type Cookie, type CookiesSetDetails } from 'electron';

import {
  BROWSER_SESSION_PROVIDERS,
  getBrowserSessionProviderPolicy,
  isBrowserSessionCookieDomainAllowed,
  isBrowserSessionNavigationAllowed,
  type BrowserSessionProviderId,
  type BrowserSessionStatus
} from '../shared/browserSession';
import { BrowserSessionVault, type BrowserSessionStoredCookie } from './browserSessionVault';

const PARTITION_PREFIX = 'ai-video-studio-browser-session';

function partitionFor(providerId: BrowserSessionProviderId): string {
  // No `persist:` prefix: Chromium never writes this isolated profile as
  // plaintext browser data. The encrypted vault is the only persistence.
  return `${PARTITION_PREFIX}-${providerId}`;
}

function cookieKey(cookie: Pick<BrowserSessionStoredCookie, 'name' | 'domain' | 'path'>): string {
  return `${cookie.domain}\u0000${cookie.path}\u0000${cookie.name}`;
}

function toStoredCookie(providerId: BrowserSessionProviderId, sourceUrl: string, cookie: Cookie): BrowserSessionStoredCookie | null {
  const domain = cookie.domain ?? new URL(sourceUrl).hostname;
  if (!isBrowserSessionCookieDomainAllowed(providerId, domain)) return null;
  return {
    name: cookie.name ?? '',
    value: cookie.value ?? '',
    domain,
    hostOnly: cookie.hostOnly ?? false,
    path: cookie.path ?? '/',
    secure: cookie.secure ?? sourceUrl.startsWith('https://'),
    httpOnly: cookie.httpOnly ?? false,
    session: cookie.session ?? cookie.expirationDate === undefined,
    ...(cookie.expirationDate === undefined ? {} : { expirationDate: cookie.expirationDate }),
    ...(cookie.sameSite === undefined ? {} : { sameSite: cookie.sameSite }),
    sourceUrl
  };
}

function toElectronCookie(cookie: BrowserSessionStoredCookie): CookiesSetDetails {
  return {
    url: cookie.sourceUrl,
    name: cookie.name,
    value: cookie.value,
    ...(cookie.hostOnly ? {} : { domain: cookie.domain }),
    path: cookie.path,
    secure: cookie.secure,
    httpOnly: cookie.httpOnly,
    ...(cookie.expirationDate === undefined ? {} : { expirationDate: cookie.expirationDate }),
    ...(cookie.sameSite === undefined ? {} : { sameSite: cookie.sameSite })
  };
}

export class BrowserSessionService {
  private readonly activeProviders = new Set<BrowserSessionProviderId>();

  constructor(private readonly vault: BrowserSessionVault) {}

  async getStatuses(): Promise<readonly BrowserSessionStatus[]> {
    return Promise.all(BROWSER_SESSION_PROVIDERS.map(async (providerId) => {
      if (this.activeProviders.has(providerId)) {
        const policy = getBrowserSessionProviderPolicy(providerId);
        return {
          providerId,
          kind: 'needs_user_action',
          origin: policy.applicationOrigin,
          reason: 'Finish signing in in the isolated browser window, then close it.'
        } satisfies BrowserSessionStatus;
      }
      return this.vault.getStatus(providerId);
    }));
  }

  async start(providerId: BrowserSessionProviderId): Promise<BrowserSessionStatus> {
    const policy = getBrowserSessionProviderPolicy(providerId);
    if (this.activeProviders.has(providerId)) {
      return {
        providerId,
        kind: 'needs_user_action',
        origin: policy.applicationOrigin,
        reason: 'A sign-in window is already open.'
      };
    }

    this.activeProviders.add(providerId);
    try {
      const isolatedSession = session.fromPartition(partitionFor(providerId), { cache: false });
      await isolatedSession.clearStorageData();
      const existing = await this.vault.loadSecret(providerId);
      if (existing !== null) {
        for (const cookie of existing.cookies) {
          await isolatedSession.cookies.set(toElectronCookie(cookie));
        }
      }

      const loginWindow = new BrowserWindow({
        width: 1120,
        height: 820,
        minWidth: 720,
        minHeight: 560,
        title: `Sign in to ${policy.label}`,
        autoHideMenuBar: true,
        webPreferences: {
          partition: partitionFor(providerId),
          contextIsolation: true,
          sandbox: true,
          nodeIntegration: false,
          webSecurity: true,
          devTools: false
        }
      });

      const guardNavigation = (event: Electron.Event, url: string): void => {
        if (!isBrowserSessionNavigationAllowed(providerId, url)) event.preventDefault();
      };
      loginWindow.webContents.on('will-navigate', guardNavigation);
      loginWindow.webContents.on('will-redirect', guardNavigation);
      loginWindow.webContents.setWindowOpenHandler(({ url }) => {
        if (isBrowserSessionNavigationAllowed(providerId, url)) {
          void loginWindow.loadURL(url);
        }
        return { action: 'deny' };
      });

      await loginWindow.loadURL(policy.loginUrl);
      await new Promise<void>((resolve) => loginWindow.once('closed', resolve));

      const collected = new Map<string, BrowserSessionStoredCookie>();
      for (const sourceUrl of policy.allowedNavigationOrigins) {
        const cookies = await isolatedSession.cookies.get({ url: sourceUrl });
        for (const cookie of cookies) {
          const stored = toStoredCookie(providerId, sourceUrl, cookie);
          if (stored !== null) collected.set(cookieKey(stored), stored);
        }
      }

      if (collected.size === 0) {
        await this.vault.clear(providerId);
        return {
          providerId,
          kind: 'needs_user_action',
          origin: policy.applicationOrigin,
          reason: 'No provider session was found. Sign in and close the window only after the provider page has loaded.'
        };
      }

      return this.vault.save({
        version: 1,
        providerId,
        storedAt: new Date().toISOString(),
        cookies: [...collected.values()]
      });
    } finally {
      this.activeProviders.delete(providerId);
    }
  }

  async clear(providerId: BrowserSessionProviderId): Promise<BrowserSessionStatus> {
    if (this.activeProviders.has(providerId)) {
      const policy = getBrowserSessionProviderPolicy(providerId);
      return {
        providerId,
        kind: 'needs_user_action',
        origin: policy.applicationOrigin,
        reason: 'Close the active sign-in window before clearing this session.'
      };
    }
    await this.vault.clear(providerId);
    await session.fromPartition(partitionFor(providerId), { cache: false }).clearStorageData();
    return this.vault.getStatus(providerId);
  }
}
