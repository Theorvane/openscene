import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const readRepo = (path: string): Promise<string> => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

describe('browser session security wiring', () => {
  it('keeps cookie payload types in main and exposes only status/actions through preload', async () => {
    const [preload, handler, service] = await Promise.all([
      readRepo('src/preload/index.ts'),
      readRepo('src/main/registerBrowserSessionIpcHandlers.ts'),
      readRepo('src/main/browserSessionService.ts')
    ]);

    const publicLines = preload.split('\n').filter((line) => line.includes('BrowserSession')).join('\n');
    expect(publicLines).toContain('BrowserSessionStatus');
    expect(publicLines).toContain('BrowserSessionProviderId');
    expect(publicLines).not.toMatch(/Cookie|domain|profilePath/);
    expect(handler).toContain('parseBrowserSessionProviderId(payload)');
    expect(handler).not.toContain('cookies.set');
    expect(service).toContain('No `persist:` prefix');
    expect(service).toContain('contextIsolation: true');
    expect(service).toContain('sandbox: true');
    expect(service).toContain('nodeIntegration: false');
    expect(service).toContain('devTools: false');
  });

  it('shows desktop controls while mobile clearly disables the unsupported lane', async () => {
    const [desktop, mobile] = await Promise.all([
      readRepo('src/renderer/src/BrowserSessionSettings.tsx'),
      readRepo('mobile/src/screens/SettingsScreen.tsx')
    ]);
    expect(desktop).toContain('window.videoTool.startBrowserSession(providerId)');
    expect(desktop).toContain('window.videoTool.clearBrowserSession(providerId)');
    expect(desktop).toContain("does not read another browser's profile");
    expect(mobile).toContain('browser-session sign-in is desktop-only');
    expect(mobile).toContain('Keychain or Keystore');
  });
});
