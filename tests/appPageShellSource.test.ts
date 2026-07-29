import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

const APP_SOURCE_URL = new URL('../src/renderer/src/App.tsx', import.meta.url);
const APP_SHELL_SOURCE_URL = new URL('../src/renderer/src/AppShell.tsx', import.meta.url);
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
    // The menu page is gone; workspace tabs switch the surfaces it used to list.
    expect(app).not.toContain('<HomePage');
    expect(app).toContain('idBase="workspace"');
    expect(app).toContain('<SettingsWorkspace onReplayFirstRunOnboarding={replayFirstRunOnboarding} />');
    expect(app).toContain('hidden={!workspaceIsVisible}');
  });

  it('opens Projects and Settings from product chrome instead of workspace navigation', async () => {
    const [app, appShell] = await Promise.all([readSource(APP_SOURCE_URL), readSource(APP_SHELL_SOURCE_URL)]);

    expect(appShell).toContain('onPageChange: (pageId: AppPageId) => void;');
    expect(appShell).not.toContain('app-page-panel-home');
    expect(appShell).toContain('aria-controls="app-page-panel-projects"');
    expect(appShell).toContain('aria-controls="app-page-panel-settings"');
    expect(appShell).toContain("onClick={() => onPageChange('settings')}");
    expect(app).not.toContain('AppWorkspaceNavigation');
    expect(app).not.toContain('aria-label="Application workspaces"');
  });

  it('gates workspace navigation behind an active project (Projects → workspace)', async () => {
    const [app, appShell] = await Promise.all([readSource(APP_SOURCE_URL), readSource(APP_SHELL_SOURCE_URL)]);

    expect(app).toContain('const hasActiveProject = editor.project !== null;');
    expect(app).toContain('if (isProjectRequiredPageId(pageId) && !hasActiveProject) {');
    expect(app).toContain("navigateToPage('projects');");
    expect(app).toContain('if (hasActiveProject || !isProjectRequiredPageId(activePageId)) return;');
    expect(app).toContain('const opened = await editor.openProjectFolder();');
    expect(app).toContain('const opened = await editor.openProject(projectId);');
    expect(app).toContain("if (opened) navigateToPage('edit');");
    expect(app).toContain('hasActiveProject={hasActiveProject}');
    expect(appShell).toContain('readonly hasActiveProject: boolean;');
  });

  it('offers Back navigation over a bounded page-history stack with the same project guard', async () => {
    const [app, appShell] = await Promise.all([readSource(APP_SOURCE_URL), readSource(APP_SHELL_SOURCE_URL)]);

    expect(app).toContain('pushPageHistory(current, activePageId)');
    expect(app).toContain('const navigateBack = useCallback');
    expect(app).toContain("isProjectRequiredPageId(target) && editor.project === null ? 'projects' : target");
    expect(app).toContain('if (isWorkspacePageId(resolved)) setActiveWorkspaceId(resolved);');
    expect(app).toContain('canNavigateBack={pageHistory.length > 0}');
    expect(app).toContain('onNavigateBack={navigateBack}');
    expect(appShell).toContain('aria-label="Back"');
    expect(appShell).toContain('disabled={!canNavigateBack}');
  });

  it('keeps mounted workspace panels directly labeled after removing the sidebar', async () => {
    const app = await readSource(APP_SOURCE_URL);

    expect(app).toContain('className="app-workspace-panel-stack"');
    expect(app).toContain('className="visually-hidden"');
    expect(app).toContain('id={EDIT_WORKSPACE.navId}');
    expect(app).toContain('{EDIT_WORKSPACE.label}');
    // Voice and video generation are dock tabs inside the editor, not pages.
    expect(app).not.toContain('VOICE_GENERATION_WORKSPACE');
    expect(app).not.toContain('VIDEO_GENERATION_WORKSPACE');
  });


  it('documents the workspace tab strip as the only workspace entry surface', async () => {
    const design = await readSource(DESIGN_SOURCE_URL);

    expect(design).toContain('do not reintroduce a left workspace sidebar');
    expect(design).toContain('There is no menu page: the workspace tab strip switches between Editing, Voice Generation, and Video Generation');
    expect(design).toContain('voice and video generation are tabs within it');
    expect(design).not.toContain('a left sidebar for workspace navigation');
    expect(design).not.toContain('Application workspace switching belongs to `AppWorkspaceNavigation`');
  });
});
