import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

const APP_SOURCE_URL = new URL('../src/renderer/src/App.tsx', import.meta.url);
const APP_SHELL_SOURCE_URL = new URL('../src/renderer/src/AppShell.tsx', import.meta.url);
const HOME_PAGE_SOURCE_URL = new URL('../src/renderer/src/HomePage.tsx', import.meta.url);
const DESIGN_SOURCE_URL = new URL('../DESIGN.md', import.meta.url);

async function readSource(url: URL): Promise<string> {
  return readFile(url, 'utf8');
}

describe('app page shell source contract', () => {
  it('keeps active page state separate from active workspace state', async () => {
    const app = await readSource(APP_SOURCE_URL);

    expect(app).toContain('const [activePageId, setActivePageId] = useState<AppPageId>(() => getDefaultAppPageId());');
    expect(app).toContain('const [activeWorkspaceId, setActiveWorkspaceId] = useState<AppWorkspaceId>(() => getDefaultAppWorkspaceId());');
    expect(app).toContain('const workspaceIsVisible = isWorkspacePageId(activePageId);');
    expect(app).toContain('<HomePage onWorkspaceOpen={setActiveWorkspace} workspaces={APP_WORKSPACES} />');
    expect(app).toContain('<SettingsWorkspace />');
    expect(app).toContain('hidden={!workspaceIsVisible}');
  });

  it('opens Home and Settings from product chrome instead of workspace navigation', async () => {
    const [app, appShell] = await Promise.all([readSource(APP_SOURCE_URL), readSource(APP_SHELL_SOURCE_URL)]);

    expect(appShell).toContain('onPageChange: (pageId: AppPageId) => void;');
    expect(appShell).toContain('aria-controls="app-page-panel-home"');
    expect(appShell).toContain("onClick={() => onPageChange('home')}");
    expect(appShell).toContain('aria-controls="app-page-panel-settings"');
    expect(appShell).toContain("onClick={() => onPageChange('settings')}");
    expect(app).not.toContain('AppWorkspaceNavigation');
    expect(app).not.toContain('aria-label="Application workspaces"');
  });

  it('keeps mounted workspace panels directly labeled after removing the sidebar', async () => {
    const app = await readSource(APP_SOURCE_URL);

    expect(app).toContain('className="app-workspace-panel-stack"');
    expect(app).toContain('className="visually-hidden"');
    expect(app).toContain('id={EDIT_WORKSPACE.navId}');
    expect(app).toContain('id={VOICE_GENERATION_WORKSPACE.navId}');
    expect(app).toContain('id={VIDEO_GENERATION_WORKSPACE.navId}');
    expect(app).toContain('{EDIT_WORKSPACE.label}');
    expect(app).toContain('{VOICE_GENERATION_WORKSPACE.label}');
    expect(app).toContain('{VIDEO_GENERATION_WORKSPACE.label}');
  });

  it('renders Home entry cards in the requested workspace order with accessible controls', async () => {
    const homePage = await readSource(HOME_PAGE_SOURCE_URL);

    expect(homePage.indexOf("edit: {")).toBeLessThan(homePage.indexOf("'voice-generation': {"));
    expect(homePage.indexOf("'voice-generation': {")).toBeLessThan(homePage.indexOf("'video-generation': {"));
    expect(homePage).toContain('className="home-card"');
    expect(homePage).toContain('aria-controls={workspace.panelId}');
    expect(homePage).toContain('onClick={() => onWorkspaceOpen(workspace.id)}');
  });

  it('documents Home cards as the only workspace entry surface after sidebar removal', async () => {
    const design = await readSource(DESIGN_SOURCE_URL);

    expect(design).toContain('do not reintroduce a left workspace sidebar');
    expect(design).toContain('Home entry cards are the workspace navigation');
    expect(design).not.toContain('a left sidebar for workspace navigation');
    expect(design).not.toContain('Application workspace switching belongs to `AppWorkspaceNavigation`');
  });
});
