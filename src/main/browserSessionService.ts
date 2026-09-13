import {
  BrowserWindow,
  session,
  type Cookie,
  type CookiesSetDetails,
  type DownloadItem,
  type WebContents,
  type WebRequestFilter
} from 'electron';
import { randomUUID } from 'node:crypto';
import { readFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  BROWSER_SESSION_PROVIDERS,
  browserSessionDiagnosticError,
  browserSessionDiagnosticTarget,
  buildGoogleFlowImagePrompt,
  buildGoogleFlowVideoPrompt,
  googleFlowImageModelFor,
  googleFlowVideoModelFor,
  getBrowserSessionProviderPolicy,
  isBrowserSessionCookieDomainAllowed,
  isBrowserSessionNavigationAllowed,
  normalizeGoogleFlowProjectName,
  type BrowserSessionProviderId,
  type BrowserSessionStatus
} from '../shared/browserSession';
import type { ReferenceImageSelection } from '../shared/providerSeams';
import type { VideoOperation } from '../shared/mediaCapabilityRegistry';
import { BrowserSessionVault, type BrowserSessionStoredCookie } from './browserSessionVault';
import { automateGoogleFlowImageGeneration, detectDownloadedImageMime } from './googleFlowImageAutomation';
import { automateGoogleFlowVideoGeneration, detectDownloadedMp4 } from './googleFlowVideoAutomation';
import { automateGrokImagineGeneration, buildGrokImaginePrompt } from './grokImagineAutomation';

const PARTITION_PREFIX = 'ai-video-studio-browser-session';
const BROWSER_SIGN_IN_PAGE_LOAD_TIMEOUT_MS = 60_000;
const BROWSER_SIGN_IN_STILL_OPEN_MS = 45_000;
const GROK_DIAGNOSTIC_REQUEST_FILTER: WebRequestFilter = {
  urls: [
    'https://grok.com/*',
    'https://x.com/*',
    'https://x.ai/*',
    'https://accounts.x.ai/*',
    'https://auth.x.ai/*',
    'https://auth.grok.com/*',
    'https://auth.grokusercontent.com/*',
    'https://auth.grokipedia.com/*',
    'https://api.x.ai/*',
    'https://challenges.cloudflare.com/*'
  ]
};
const GOOGLE_FLOW_IMAGE_TIMEOUT_MS = 4 * 60_000;
const GOOGLE_FLOW_PAGE_LOAD_TIMEOUT_MS = 60_000;
const GOOGLE_FLOW_DOWNLOAD_TIMEOUT_MS = 60_000;
const MAX_BROWSER_IMAGE_BYTES = 50 * 1024 * 1024;
const GOOGLE_FLOW_VIDEO_TIMEOUT_MS = 12 * 60_000;
const GOOGLE_FLOW_VIDEO_DOWNLOAD_TIMEOUT_MS = 2 * 60_000;
const MAX_BROWSER_VIDEO_BYTES = 500 * 1024 * 1024;

function logBrowserSession(
  providerId: BrowserSessionProviderId,
  event: string,
  details: Readonly<Record<string, unknown>> = {}
): void {
  const suffix = Object.keys(details).length === 0 ? '' : ` ${JSON.stringify(details)}`;
  console.info(`[OpenScene][Browser Session][${providerId}] ${event}${suffix}`);
}

export type GoogleFlowImageGenerationInput = {
  readonly modelId: string;
  readonly prompt: string;
  readonly aspectRatio: string;
  readonly stylePreset?: string;
  readonly negativePrompt?: string;
  readonly referenceImage?: ReferenceImageSelection;
  readonly referenceImages?: readonly ReferenceImageSelection[];
  readonly showBrowserWindow?: boolean;
  readonly projectName?: string;
};

export type BrowserSessionGeneratedImage = {
  readonly bytes: Buffer;
  readonly mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
  readonly providerJobId: string;
};

export type GoogleFlowVideoGenerationInput = {
  readonly modelId: string;
  readonly prompt: string;
  readonly operation: VideoOperation;
  readonly aspectRatio: string;
  readonly durationSeconds: number;
  readonly stylePreset?: string;
  readonly referenceImage?: ReferenceImageSelection;
  readonly lastFrame?: ReferenceImageSelection;
  readonly referenceImages?: readonly ReferenceImageSelection[];
  readonly showBrowserWindow?: boolean;
  readonly projectName?: string;
};

export type BrowserSessionGeneratedVideo = {
  readonly bytes: Buffer;
  readonly providerJobId: string;
};

export type GrokImagineImageGenerationInput = {
  readonly prompt: string;
  readonly aspectRatio: string;
  readonly negativePrompt?: string;
  readonly referenceImage?: ReferenceImageSelection;
  readonly showBrowserWindow?: boolean;
};

export type GrokImagineVideoGenerationInput = {
  readonly prompt: string;
  readonly operation: VideoOperation;
  readonly aspectRatio: string;
  readonly durationSeconds: number;
  readonly stylePreset?: string;
  readonly referenceImage?: ReferenceImageSelection;
  readonly showBrowserWindow?: boolean;
};

async function withTimeout<T>(operation: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  try {
    return await Promise.race([operation, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function isAbortedNavigation(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const navigationError = error as Error & { readonly code?: unknown; readonly errno?: unknown };
  return navigationError.code === 'ERR_ABORTED'
    || navigationError.errno === -3
    || /ERR_ABORTED\s*\(-3\)/i.test(navigationError.message);
}

async function loadAllowedProviderPage(
  webContents: WebContents,
  providerId: BrowserSessionProviderId,
  url: string,
  onRedirectSettled?: (url: string) => void
): Promise<void> {
  try {
    await webContents.loadURL(url);
  } catch (error) {
    if (!isAbortedNavigation(error)) throw error;

    // Electron rejects loadURL with ERR_ABORTED when an allowed provider page
    // replaces the initial navigation. The navigation guard still blocks every
    // origin outside the exact provider allowlist. Give the replacement URL a
    // short window to appear, then let the Flow DOM readiness loop take over.
    for (let attempt = 0; attempt < 25; attempt += 1) {
      const currentUrl = webContents.getURL();
      if (isBrowserSessionNavigationAllowed(providerId, currentUrl)) {
        onRedirectSettled?.(currentUrl);
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    throw error;
  }
}

async function removeTemporaryDownload(filePath: string): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await unlink(filePath);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') return;
      if (code !== 'EBUSY' && code !== 'EPERM') return;
      await new Promise((resolve) => setTimeout(resolve, 100 * (attempt + 1)));
    }
  }
}

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
  private readonly instrumentedSessions = new WeakSet<Electron.Session>();

  constructor(
    private readonly vault: BrowserSessionVault,
    private readonly temporaryDirectory: string = tmpdir()
  ) {}

  private instrumentGrokSession(isolatedSession: Electron.Session): void {
    if (this.instrumentedSessions.has(isolatedSession)) return;
    this.instrumentedSessions.add(isolatedSession);

    isolatedSession.webRequest.onCompleted(GROK_DIAGNOSTIC_REQUEST_FILTER, (details) => {
      if (details.statusCode < 400) return;
      logBrowserSession('grok', 'request.http-error', {
        method: details.method,
        resourceType: details.resourceType,
        statusCode: details.statusCode,
        target: browserSessionDiagnosticTarget(details.url)
      });
    });
    isolatedSession.webRequest.onErrorOccurred(GROK_DIAGNOSTIC_REQUEST_FILTER, (details) => {
      logBrowserSession('grok', 'request.failed', {
        method: details.method,
        resourceType: details.resourceType,
        error: browserSessionDiagnosticError(details.error),
        target: browserSessionDiagnosticTarget(details.url)
      });
    });
  }

  private async loadIntoPartition(providerId: BrowserSessionProviderId): Promise<Electron.Session> {
    const isolatedSession = session.fromPartition(partitionFor(providerId), { cache: false });
    if (providerId === 'grok') this.instrumentGrokSession(isolatedSession);
    // Rehydrate authentication from the encrypted vault on every operation,
    // while keeping the non-persistent partition's in-memory Flow project map
    // alive for the rest of this app run. `clear()` still removes all storage.
    await isolatedSession.clearStorageData({ storages: ['cookies'] });
    const existing = await this.vault.loadSecret(providerId);
    if (existing !== null) {
      for (const cookie of existing.cookies) {
        await isolatedSession.cookies.set(toElectronCookie(cookie));
      }
    }
    return isolatedSession;
  }

  private async persistPartition(providerId: BrowserSessionProviderId, isolatedSession: Electron.Session): Promise<void> {
    const policy = getBrowserSessionProviderPolicy(providerId);
    const collected = new Map<string, BrowserSessionStoredCookie>();
    for (const sourceUrl of policy.allowedNavigationOrigins) {
      const cookies = await isolatedSession.cookies.get({ url: sourceUrl });
      for (const cookie of cookies) {
        const stored = toStoredCookie(providerId, sourceUrl, cookie);
        if (stored !== null) collected.set(cookieKey(stored), stored);
      }
    }
    if (collected.size > 0) {
      await this.vault.save({
        version: 1,
        providerId,
        storedAt: new Date().toISOString(),
        cookies: [...collected.values()]
      });
    }
  }

  async getStatuses(): Promise<readonly BrowserSessionStatus[]> {
    return Promise.all(BROWSER_SESSION_PROVIDERS.map(async (providerId) => {
      if (this.activeProviders.has(providerId)) {
        const policy = getBrowserSessionProviderPolicy(providerId);
        return {
          providerId,
          kind: 'needs_user_action',
          origin: policy.applicationOrigin,
          reason: 'A sign-in window or background provider operation is active.'
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
      const isolatedSession = await this.loadIntoPartition(providerId);

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
        const allowed = isBrowserSessionNavigationAllowed(providerId, url);
        logBrowserSession(providerId, allowed ? 'navigation.allowed' : 'navigation.blocked', {
          target: browserSessionDiagnosticTarget(url)
        });
        if (!allowed) event.preventDefault();
      };
      loginWindow.webContents.on('will-navigate', guardNavigation);
      loginWindow.webContents.on('will-redirect', guardNavigation);
      loginWindow.webContents.setWindowOpenHandler(({ url }) => {
        const allowed = isBrowserSessionNavigationAllowed(providerId, url);
        logBrowserSession(providerId, allowed ? 'popup.redirected' : 'popup.blocked', {
          target: browserSessionDiagnosticTarget(url)
        });
        if (allowed) {
          void loginWindow.loadURL(url);
        }
        return { action: 'deny' };
      });
      loginWindow.webContents.on('did-finish-load', () => {
        logBrowserSession(providerId, 'page.loaded', {
          target: browserSessionDiagnosticTarget(loginWindow.webContents.getURL())
        });
      });
      loginWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedUrl, isMainFrame) => {
        if (!isMainFrame) return;
        logBrowserSession(providerId, 'page.failed', {
          error: browserSessionDiagnosticError(errorDescription),
          errorCode,
          target: browserSessionDiagnosticTarget(validatedUrl)
        });
      });
      loginWindow.webContents.on('render-process-gone', (_event, details) => {
        logBrowserSession(providerId, 'renderer.gone', { reason: details.reason });
      });
      loginWindow.on('unresponsive', () => {
        logBrowserSession(providerId, 'window.unresponsive');
      });

      const windowClosed = new Promise<void>((resolve) => loginWindow.once('closed', resolve));
      const stillOpenTimer = setTimeout(() => {
        if (loginWindow.isDestroyed()) return;
        logBrowserSession(providerId, 'signin.still-open', {
          elapsedSeconds: Math.round(BROWSER_SIGN_IN_STILL_OPEN_MS / 1000),
          target: browserSessionDiagnosticTarget(loginWindow.webContents.getURL())
        });
      }, BROWSER_SIGN_IN_STILL_OPEN_MS);
      logBrowserSession(providerId, 'signin.opening', {
        target: browserSessionDiagnosticTarget(policy.loginUrl)
      });
      try {
        await withTimeout(
          loadAllowedProviderPage(loginWindow.webContents, providerId, policy.loginUrl, (redirectUrl) => {
            logBrowserSession(providerId, 'navigation.redirect-settled', {
              target: browserSessionDiagnosticTarget(redirectUrl)
            });
          }),
          BROWSER_SIGN_IN_PAGE_LOAD_TIMEOUT_MS,
          `${policy.label} sign-in page did not finish loading within 60 seconds.`
        );
        await windowClosed;
        logBrowserSession(providerId, 'signin.window-closed');
      } finally {
        clearTimeout(stillOpenTimer);
        if (!loginWindow.isDestroyed()) loginWindow.destroy();
      }

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

  /**
   * Generate through the normal Google Labs Flow application in a real
   * Chromium renderer which can be visible for observability. Cookie material remains inside the isolated Electron
   * session; automation sees only DOM geometry and the downloaded image.
   */
  async generateGrokImagineImage(input: GrokImagineImageGenerationInput): Promise<BrowserSessionGeneratedImage> {
    return this.generateGrokImagineMedia('image', input) as Promise<BrowserSessionGeneratedImage>;
  }

  async generateGrokImagineVideo(input: GrokImagineVideoGenerationInput): Promise<BrowserSessionGeneratedVideo> {
    if (!['text_to_video', 'image_to_video'].includes(input.operation)) {
      throw new Error(`Grok Imagine browser session does not support ${input.operation} in this build.`);
    }
    return this.generateGrokImagineMedia('video', input);
  }

  private async generateGrokImagineMedia(
    kind: 'image' | 'video',
    input: GrokImagineImageGenerationInput | GrokImagineVideoGenerationInput
  ): Promise<BrowserSessionGeneratedImage | BrowserSessionGeneratedVideo> {
    const providerId = 'grok' as const;
    if (this.activeProviders.has(providerId)) throw new Error('Grok Imagine is already being used by another browser-session operation. Wait for it to finish and retry.');
    const requestId = randomUUID().slice(0, 8);
    const temporaryPath = join(this.temporaryDirectory, `openscene-grok-${kind}-${requestId}.download`);
    const showBrowserWindow = input.showBrowserWindow !== false;
    const timeoutMs = kind === 'image' ? GOOGLE_FLOW_IMAGE_TIMEOUT_MS : GOOGLE_FLOW_VIDEO_TIMEOUT_MS;
    const downloadTimeoutMs = kind === 'image' ? GOOGLE_FLOW_DOWNLOAD_TIMEOUT_MS : GOOGLE_FLOW_VIDEO_DOWNLOAD_TIMEOUT_MS;
    const log = (event: string, details: Readonly<Record<string, unknown>> = {}): void => {
      const suffix = Object.keys(details).length === 0 ? '' : ` ${JSON.stringify(details)}`;
      console.info(`[OpenScene][Grok Imagine ${kind}][${requestId}] ${event}${suffix}`);
    };
    let isolatedSession: Electron.Session | undefined;
    let automationWindow: BrowserWindow | undefined;
    let downloadListener: ((event: Electron.Event, item: DownloadItem, webContents: WebContents) => void) | undefined;
    let downloadTimer: ReturnType<typeof setTimeout> | undefined;
    let downloadArmed = false;
    let operationSettled = false;
    let activeDownloadItem: DownloadItem | undefined;
    let windowClosed: Promise<never> | undefined;
    this.activeProviders.add(providerId);
    try {
      const stored = await this.vault.loadSecret(providerId);
      if (stored === null || stored.cookies.length === 0) throw new Error('No Grok browser session is stored. Open Settings, sign in to Grok, close that window, then retry.');
      isolatedSession = await this.loadIntoPartition(providerId);
      automationWindow = new BrowserWindow({
        width: 1280, height: 900, show: showBrowserWindow, skipTaskbar: !showBrowserWindow,
        title: `OpenScene Grok Imagine ${kind} worker`, backgroundColor: '#101010', autoHideMenuBar: true,
        webPreferences: { partition: partitionFor(providerId), contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true, devTools: false, backgroundThrottling: false }
      });
      windowClosed = new Promise<never>((_resolve, reject) => automationWindow!.once('closed', () => {
        if (!operationSettled) reject(new Error(`The Grok Imagine window was closed before ${kind} generation completed.`));
      }));
      void windowClosed.catch(() => undefined);
      const guard = (event: Electron.Event, url: string): void => { if (!isBrowserSessionNavigationAllowed(providerId, url)) event.preventDefault(); };
      automationWindow.webContents.on('will-navigate', guard);
      automationWindow.webContents.on('will-redirect', guard);
      automationWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      const download = new Promise<BrowserSessionGeneratedImage | BrowserSessionGeneratedVideo>((resolve, reject) => {
        downloadListener = (event, item, sourceWebContents) => {
          if (sourceWebContents.id !== automationWindow!.webContents.id) return;
          if (!downloadArmed) { event.preventDefault(); reject(new Error(`Grok Imagine attempted an unexpected ${kind} download before generation completed.`)); return; }
          downloadArmed = false;
          activeDownloadItem = item;
          const maximumBytes = kind === 'image' ? MAX_BROWSER_IMAGE_BYTES : MAX_BROWSER_VIDEO_BYTES;
          if (item.getTotalBytes() > maximumBytes) { event.preventDefault(); reject(new Error(`Grok Imagine declared a ${kind} larger than the browser-session limit.`)); return; }
          item.setSavePath(temporaryPath);
          let exceededLimit = false;
          item.on('updated', () => {
            if (item.getReceivedBytes() <= maximumBytes) return;
            exceededLimit = true;
            item.cancel();
          });
          item.once('done', (_event, state) => void (async () => {
            if (exceededLimit) throw new Error(`Grok Imagine ${kind} exceeded the browser-session download limit.`);
            if (state !== 'completed') throw new Error(`Grok Imagine ${kind} download ${state}.`);
            const bytes = await readFile(temporaryPath);
            if (kind === 'image') {
              if (bytes.length === 0 || bytes.length > MAX_BROWSER_IMAGE_BYTES) throw new Error('Grok Imagine returned an empty or unexpectedly large image download.');
              const mimeType = detectDownloadedImageMime(bytes);
              if (mimeType === null) throw new Error('Grok Imagine download was not a valid PNG, JPEG, or WebP image.');
              resolve({ bytes, mimeType, providerJobId: `grok-imagine-browser-${requestId}` });
            } else {
              if (bytes.length === 0 || bytes.length > MAX_BROWSER_VIDEO_BYTES || !detectDownloadedMp4(bytes)) throw new Error('Grok Imagine download was not a valid MP4 within the browser-session limit.');
              resolve({ bytes, providerJobId: `grok-imagine-browser-video-${requestId}` });
            }
          })().catch((error: unknown) => reject(error instanceof Error ? error : new Error(`Grok Imagine ${kind} download could not be read.`))));
        };
        isolatedSession!.on('will-download', downloadListener);
      });
      void download.catch(() => undefined);
      await Promise.race([
        withTimeout(loadAllowedProviderPage(automationWindow.webContents, providerId, 'https://grok.com/imagine'), GOOGLE_FLOW_PAGE_LOAD_TIMEOUT_MS, 'Grok Imagine did not finish loading within 60 seconds.'),
        windowClosed
      ]);
      const automationPrompt = kind === 'image'
        ? buildGrokImaginePrompt(input.prompt, { negativePrompt: (input as GrokImagineImageGenerationInput).negativePrompt })
        : buildGrokImaginePrompt(input.prompt, { stylePreset: (input as GrokImagineVideoGenerationInput).stylePreset });
      const operation = kind === 'image' ? 'image' : (input as GrokImagineVideoGenerationInput).operation;
      const generatedUrl = await Promise.race([
        automateGrokImagineGeneration(automationWindow.webContents, {
          prompt: automationPrompt,
          operation: operation as 'image' | 'text_to_video' | 'image_to_video',
          aspectRatio: input.aspectRatio,
          ...('durationSeconds' in input ? { durationSeconds: input.durationSeconds } : {}),
          ...(input.referenceImage === undefined ? {} : { referenceImage: input.referenceImage }),
          timeoutMs,
          onProgress: (stage, elapsedMs, details = {}) => log(`browser.${stage}`, { elapsedSeconds: Math.round(elapsedMs / 1_000), ...details })
        }),
        windowClosed
      ]);
      downloadArmed = true;
      automationWindow.webContents.downloadURL(generatedUrl);
      const timeout = new Promise<never>((_resolve, reject) => { downloadTimer = setTimeout(() => reject(new Error(`Grok Imagine created ${kind} media, but its browser download did not finish in time.`)), downloadTimeoutMs); });
      const result = await Promise.race([download, timeout, windowClosed]);
      operationSettled = true;
      return result;
    } finally {
      operationSettled = true;
      if (downloadTimer !== undefined) clearTimeout(downloadTimer);
      if (isolatedSession !== undefined && downloadListener !== undefined) isolatedSession.removeListener('will-download', downloadListener);
      if (activeDownloadItem?.getState() === 'progressing') activeDownloadItem.cancel();
      if (isolatedSession !== undefined) await this.persistPartition(providerId, isolatedSession).catch(() => undefined);
      if (automationWindow !== undefined && !automationWindow.isDestroyed()) automationWindow.destroy();
      await removeTemporaryDownload(temporaryPath);
      this.activeProviders.delete(providerId);
    }
  }

  async generateGoogleFlowImage(input: GoogleFlowImageGenerationInput): Promise<BrowserSessionGeneratedImage> {
    const providerId = 'gemini' as const;
    const policy = getBrowserSessionProviderPolicy(providerId);
    if (this.activeProviders.has(providerId)) {
      throw new Error('Google Flow is already being used by another browser-session operation. Wait for it to finish and retry.');
    }

    const requestId = randomUUID().slice(0, 8);
    const log = (event: string, details: Readonly<Record<string, unknown>> = {}): void => {
      const suffix = Object.keys(details).length === 0 ? '' : ` ${JSON.stringify(details)}`;
      console.info(`[OpenScene][Google Flow Image][${requestId}] ${event}${suffix}`);
    };
    const prompt = buildGoogleFlowImagePrompt(input);
    const projectName = normalizeGoogleFlowProjectName(input.projectName);
    const showBrowserWindow = input.showBrowserWindow !== false;
    const temporaryPath = join(this.temporaryDirectory, `openscene-flow-image-${requestId}.download`);
    let isolatedSession: Electron.Session | undefined;
    let automationWindow: BrowserWindow | undefined;
    let activeDownloadItem: DownloadItem | undefined;
    let downloadListener: ((event: Electron.Event, item: DownloadItem, webContents: WebContents) => void) | undefined;
    let downloadTimer: ReturnType<typeof setTimeout> | undefined;
    let downloadArmed = false;
    let operationSettled = false;
    let windowClosed: Promise<never> | undefined;

    this.activeProviders.add(providerId);
    log('request.start', {
      promptCharacters: prompt.length,
      aspectRatio: input.aspectRatio,
      timeoutSeconds: GOOGLE_FLOW_IMAGE_TIMEOUT_MS / 1_000,
      visible: showBrowserWindow,
      projectName: projectName ?? '',
      projectNameCharacters: projectName?.length ?? 0
    });

    try {
      const stored = await this.vault.loadSecret(providerId);
      if (stored === null || stored.cookies.length === 0) {
        throw new Error('No Google Flow browser session is stored. Open Settings, sign in to Google Flow, close that window, then retry.');
      }
      isolatedSession = await this.loadIntoPartition(providerId);
      automationWindow = new BrowserWindow({
        width: 1280,
        height: 900,
        show: showBrowserWindow,
        skipTaskbar: !showBrowserWindow,
        title: 'OpenScene Google Flow image worker',
        backgroundColor: '#101010',
        autoHideMenuBar: true,
        webPreferences: {
          partition: partitionFor(providerId),
          contextIsolation: true,
          sandbox: true,
          nodeIntegration: false,
          webSecurity: true,
          devTools: false,
          backgroundThrottling: false
        }
      });
      windowClosed = new Promise<never>((_resolve, reject) => {
        automationWindow!.once('closed', () => {
          if (operationSettled) return;
          log('browser.closed');
          reject(new Error('The Google Flow window was closed before image generation completed.'));
        });
      });
      void windowClosed.catch(() => undefined);

      const guardNavigation = (event: Electron.Event, url: string): void => {
        if (!isBrowserSessionNavigationAllowed(providerId, url)) event.preventDefault();
      };
      automationWindow.webContents.on('will-navigate', guardNavigation);
      automationWindow.webContents.on('will-redirect', guardNavigation);
      automationWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

      const download = new Promise<BrowserSessionGeneratedImage>((resolve, reject) => {
        downloadListener = (event, item, sourceWebContents) => {
          if (automationWindow === undefined || sourceWebContents.id !== automationWindow.webContents.id) return;
          if (!downloadArmed) {
            event.preventDefault();
            reject(new Error('Google Flow attempted an unexpected download before image generation completed.'));
            return;
          }
          downloadArmed = false;
          const declaredMime = item.getMimeType().toLowerCase();
          const filename = item.getFilename().toLowerCase();
          activeDownloadItem = item;
          item.setSavePath(temporaryPath);
          log('download.started', { declaredMime, filenameExtension: filename.split('.').pop() ?? '' });
          item.once('done', (_doneEvent, state) => {
            void (async () => {
              if (state !== 'completed') {
                reject(new Error(`Google Flow image download ${state}.`));
                return;
              }
              const bytes = await readFile(temporaryPath);
              if (bytes.length === 0 || bytes.length > MAX_BROWSER_IMAGE_BYTES) {
                reject(new Error('Google Flow returned an empty or unexpectedly large image download.'));
                return;
              }
              const mimeType = detectDownloadedImageMime(bytes);
              if (mimeType === null) {
                reject(new Error('Google Flow download was not a valid PNG, JPEG, or WebP image.'));
                return;
              }
              log('download.completed', { bytes: bytes.length, mimeType });
              resolve({ bytes, mimeType, providerJobId: `google-flow-browser-${requestId}` });
            })().catch((error: unknown) => {
              reject(error instanceof Error ? error : new Error('Google Flow image download could not be read.'));
            });
          });
        };
        isolatedSession!.on('will-download', downloadListener);
      });
      // Automation can fail before it reaches the download await. Attach a
      // rejection observer now so an early rejected download never becomes an
      // unhandled promise while the browser loop is still running.
      void download.catch(() => undefined);

      log('browser.loading', { origin: policy.applicationOrigin });
      await Promise.race([
        withTimeout(
          loadAllowedProviderPage(
            automationWindow.webContents,
            providerId,
            policy.loginUrl,
            (settledUrl) => log('browser.redirect.accepted', { origin: new URL(settledUrl).origin })
          ),
          GOOGLE_FLOW_PAGE_LOAD_TIMEOUT_MS,
          'Google Flow did not finish loading within 60 seconds.'
        ),
        windowClosed
      ]);
      const generatedImageUrl = await Promise.race([
        automateGoogleFlowImageGeneration(automationWindow.webContents, {
          prompt,
          model: googleFlowImageModelFor(input.modelId),
          aspectRatio: input.aspectRatio,
          ...(input.referenceImages === undefined ? {} : { referenceImages: input.referenceImages }),
          ...(input.referenceImage === undefined ? {} : { referenceImage: input.referenceImage }),
          ...(projectName === undefined ? {} : { projectName }),
          timeoutMs: GOOGLE_FLOW_IMAGE_TIMEOUT_MS,
          onProgress: (stage, elapsedMs, details = {}) => log(`browser.${stage}`, {
            elapsedSeconds: Math.round(elapsedMs / 1_000),
            ...details
          })
        }),
        windowClosed
      ]);
      downloadArmed = true;
      automationWindow.webContents.downloadURL(generatedImageUrl);
      const downloadTimeout = new Promise<never>((_resolve, reject) => {
        downloadTimer = setTimeout(
          () => reject(new Error('Google Flow created an image, but its browser download did not finish within 60 seconds.')),
          GOOGLE_FLOW_DOWNLOAD_TIMEOUT_MS
        );
      });
      const result = await Promise.race([download, downloadTimeout, windowClosed]);
      operationSettled = true;
      log('request.completed');
      return result;
    } catch (error) {
      log('request.failed', { error: error instanceof Error ? error.message : 'unknown error' });
      throw error;
    } finally {
      operationSettled = true;
      if (downloadTimer !== undefined) clearTimeout(downloadTimer);
      if (isolatedSession !== undefined && downloadListener !== undefined) {
        isolatedSession.removeListener('will-download', downloadListener);
      }
      if (activeDownloadItem?.getState() === 'progressing') activeDownloadItem.cancel();
      if (isolatedSession !== undefined) {
        await this.persistPartition(providerId, isolatedSession).catch((error: unknown) => {
          log('session.persist.failed', { error: error instanceof Error ? error.message : 'unknown error' });
        });
      }
      if (automationWindow !== undefined && !automationWindow.isDestroyed()) automationWindow.destroy();
      await removeTemporaryDownload(temporaryPath);
      this.activeProviders.delete(providerId);
      log('cleanup.complete');
    }
  }

  /** Generate a video through the visible Flow product without exposing its session to the renderer. */
  async generateGoogleFlowVideo(input: GoogleFlowVideoGenerationInput): Promise<BrowserSessionGeneratedVideo> {
    const providerId = 'gemini' as const;
    const policy = getBrowserSessionProviderPolicy(providerId);
    if (this.activeProviders.has(providerId)) {
      throw new Error('Google Flow is already being used by another browser-session operation. Wait for it to finish and retry.');
    }
    const model = googleFlowVideoModelFor(input.modelId);
    if (model === null) {
      throw new Error(`Model ${input.modelId} has no exact counterpart in the current Google Flow video menu. Use the API lane instead.`);
    }

    const requestId = randomUUID().slice(0, 8);
    const prompt = buildGoogleFlowVideoPrompt(input);
    const projectName = normalizeGoogleFlowProjectName(input.projectName);
    const showBrowserWindow = input.showBrowserWindow !== false;
    const temporaryPath = join(this.temporaryDirectory, `openscene-flow-video-${requestId}.download`);
    const log = (event: string, details: Readonly<Record<string, unknown>> = {}): void => {
      const suffix = Object.keys(details).length === 0 ? '' : ` ${JSON.stringify(details)}`;
      console.info(`[OpenScene][Google Flow Video][${requestId}] ${event}${suffix}`);
    };
    let isolatedSession: Electron.Session | undefined;
    let automationWindow: BrowserWindow | undefined;
    let activeDownloadItem: DownloadItem | undefined;
    let downloadListener: ((event: Electron.Event, item: DownloadItem, webContents: WebContents) => void) | undefined;
    let downloadTimer: ReturnType<typeof setTimeout> | undefined;
    let downloadArmed = false;
    let operationSettled = false;
    let windowClosed: Promise<never> | undefined;

    this.activeProviders.add(providerId);
    log('request.start', {
      model: input.modelId,
      operation: input.operation,
      promptCharacters: prompt.length,
      durationSeconds: input.durationSeconds,
      aspectRatio: input.aspectRatio,
      visible: showBrowserWindow,
      referenceCount: input.operation === 'reference_to_video' ? input.referenceImages?.length ?? 0 : input.operation === 'start_end' ? 2 : input.referenceImage === undefined ? 0 : 1
    });
    try {
      const stored = await this.vault.loadSecret(providerId);
      if (stored === null || stored.cookies.length === 0) {
        throw new Error('No Google Flow browser session is stored. Open Settings, sign in to Google Flow, close that window, then retry.');
      }
      isolatedSession = await this.loadIntoPartition(providerId);
      automationWindow = new BrowserWindow({
        width: 1280,
        height: 900,
        show: showBrowserWindow,
        skipTaskbar: !showBrowserWindow,
        title: 'OpenScene Google Flow video worker',
        backgroundColor: '#101010',
        autoHideMenuBar: true,
        webPreferences: {
          partition: partitionFor(providerId),
          contextIsolation: true,
          sandbox: true,
          nodeIntegration: false,
          webSecurity: true,
          devTools: false,
          backgroundThrottling: false
        }
      });
      windowClosed = new Promise<never>((_resolve, reject) => {
        automationWindow!.once('closed', () => {
          if (operationSettled) return;
          log('browser.closed');
          reject(new Error('The Google Flow window was closed before video generation completed.'));
        });
      });
      void windowClosed.catch(() => undefined);

      const guardNavigation = (event: Electron.Event, url: string): void => {
        if (!isBrowserSessionNavigationAllowed(providerId, url)) event.preventDefault();
      };
      automationWindow.webContents.on('will-navigate', guardNavigation);
      automationWindow.webContents.on('will-redirect', guardNavigation);
      automationWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

      const download = new Promise<BrowserSessionGeneratedVideo>((resolve, reject) => {
        downloadListener = (event, item, sourceWebContents) => {
          if (automationWindow === undefined || sourceWebContents.id !== automationWindow.webContents.id) return;
          if (!downloadArmed) {
            event.preventDefault();
            reject(new Error('Google Flow attempted an unexpected download before video generation completed.'));
            return;
          }
          downloadArmed = false;
          activeDownloadItem = item;
          const declaredBytes = item.getTotalBytes();
          if (declaredBytes > MAX_BROWSER_VIDEO_BYTES) {
            event.preventDefault();
            reject(new Error('Google Flow declared a video larger than the 500 MB browser-session limit.'));
            return;
          }
          item.setSavePath(temporaryPath);
          log('download.started', { declaredMime: item.getMimeType().toLowerCase(), filenameExtension: item.getFilename().split('.').pop()?.toLowerCase() ?? '' });
          let exceededLimit = false;
          item.on('updated', () => {
            if (item.getReceivedBytes() <= MAX_BROWSER_VIDEO_BYTES) return;
            exceededLimit = true;
            item.cancel();
          });
          item.once('done', (_doneEvent, state) => {
            void (async () => {
              if (exceededLimit) throw new Error('Google Flow video exceeded the 500 MB browser-session limit while downloading.');
              if (state !== 'completed') throw new Error(`Google Flow video download ${state}.`);
              const bytes = await readFile(temporaryPath);
              if (bytes.length === 0 || bytes.length > MAX_BROWSER_VIDEO_BYTES) throw new Error('Google Flow returned an empty or unexpectedly large video download.');
              if (!detectDownloadedMp4(bytes)) throw new Error('Google Flow download was not a valid MP4 file.');
              log('download.completed', { bytes: bytes.length, mimeType: 'video/mp4' });
              resolve({ bytes, providerJobId: `google-flow-browser-video-${requestId}` });
            })().catch((error: unknown) => reject(error instanceof Error ? error : new Error('Google Flow video download could not be read.')));
          });
        };
        isolatedSession!.on('will-download', downloadListener);
      });
      void download.catch(() => undefined);

      await Promise.race([
        withTimeout(
          loadAllowedProviderPage(automationWindow.webContents, providerId, policy.loginUrl),
          GOOGLE_FLOW_PAGE_LOAD_TIMEOUT_MS,
          'Google Flow did not finish loading within 60 seconds.'
        ),
        windowClosed
      ]);
      const generatedVideoUrl = await Promise.race([
        automateGoogleFlowVideoGeneration(automationWindow.webContents, {
          prompt,
          model,
          operation: input.operation,
          aspectRatio: input.aspectRatio,
          durationSeconds: input.durationSeconds,
          ...(input.referenceImage === undefined ? {} : { referenceImage: input.referenceImage }),
          ...(input.lastFrame === undefined ? {} : { lastFrame: input.lastFrame }),
          ...(input.referenceImages === undefined ? {} : { referenceImages: input.referenceImages }),
          ...(projectName === undefined ? {} : { projectName }),
          timeoutMs: GOOGLE_FLOW_VIDEO_TIMEOUT_MS,
          onProgress: (stage, elapsedMs, details = {}) => log(`browser.${stage}`, { elapsedSeconds: Math.round(elapsedMs / 1_000), ...details })
        }),
        windowClosed
      ]);
      downloadArmed = true;
      automationWindow.webContents.downloadURL(generatedVideoUrl);
      const downloadTimeout = new Promise<never>((_resolve, reject) => {
        downloadTimer = setTimeout(
          () => reject(new Error('Google Flow created a video, but its download did not finish within two minutes.')),
          GOOGLE_FLOW_VIDEO_DOWNLOAD_TIMEOUT_MS
        );
      });
      const result = await Promise.race([download, downloadTimeout, windowClosed]);
      operationSettled = true;
      log('request.completed');
      return result;
    } catch (error) {
      log('request.failed', { error: error instanceof Error ? error.message : 'unknown error' });
      throw error;
    } finally {
      operationSettled = true;
      if (downloadTimer !== undefined) clearTimeout(downloadTimer);
      if (isolatedSession !== undefined && downloadListener !== undefined) isolatedSession.removeListener('will-download', downloadListener);
      if (activeDownloadItem?.getState() === 'progressing') activeDownloadItem.cancel();
      if (isolatedSession !== undefined) await this.persistPartition(providerId, isolatedSession).catch(() => undefined);
      if (automationWindow !== undefined && !automationWindow.isDestroyed()) automationWindow.destroy();
      await removeTemporaryDownload(temporaryPath);
      this.activeProviders.delete(providerId);
      log('cleanup.complete');
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
