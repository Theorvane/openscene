import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

const APP_SHELL_SOURCE_URL = new URL('../src/renderer/src/AppShell.tsx', import.meta.url);
const APP_SOURCE_URL = new URL('../src/renderer/src/App.tsx', import.meta.url);
const AGENT_PANEL_SOURCE_URL = new URL('../src/renderer/src/AgentChatPanel.tsx', import.meta.url);
const AGENT_CONTEXT_SOURCE_URL = new URL('../src/renderer/src/AgentChatContext.tsx', import.meta.url);
const AGENT_LAYOUT_SOURCE_URL = new URL('../src/renderer/src/agentChatLayoutPreferences.ts', import.meta.url);
const AGENT_LAYOUT_HOOK_SOURCE_URL = new URL('../src/renderer/src/useAgentChatLayoutPreference.ts', import.meta.url);
const STYLES_SOURCE_URL = new URL('../src/renderer/src/styles.css', import.meta.url);

async function readSource(url: URL): Promise<string> {
  return readFile(url, 'utf8');
}

describe('persistent agent control surface', () => {
  it('keeps AgentChatPanel mounted in AppShell and removes the toggle control', async () => {
    const [appShell, panel, styles] = await Promise.all([
      readSource(APP_SHELL_SOURCE_URL),
      readSource(AGENT_PANEL_SOURCE_URL),
      readSource(STYLES_SOURCE_URL)
    ]);

    expect(appShell).toContain('<AgentChatPanel selectedContextAsset={selectedContextAsset} width={chatPanelWidth} />');
    expect(appShell).not.toContain('AgentChatToggleButton');
    expect(panel).not.toContain('isOpen');
    expect(panel).not.toContain('closeOpen');
    expect(styles).toContain('.agent-chat-panel-shell {');
    expect(styles).toContain('width: var(--agent-chat-panel-width);');
    expect(styles).toContain('min-width: 300px;');
    expect(styles).toContain('max-width: 520px;');
    expect(styles).not.toContain('.agent-chat-panel-shell--open');
  });

  it('keeps the resizable chat splitter outside the busy workspace lock with an accessible separator contract', async () => {
    const [appShell, styles] = await Promise.all([readSource(APP_SHELL_SOURCE_URL), readSource(STYLES_SOURCE_URL)]);

    expect(appShell.indexOf('className="agent-workspace-lock"')).toBeLessThan(appShell.indexOf('className="agent-chat-resize-splitter"'));
    expect(appShell).toContain('role="separator"');
    expect(appShell).toContain('aria-orientation="vertical"');
    expect(appShell).toContain('aria-valuemin={AGENT_CHAT_LAYOUT_MIN_WIDTH}');
    expect(appShell).toContain('aria-valuemax={AGENT_CHAT_LAYOUT_MAX_WIDTH}');
    expect(appShell).toContain('aria-valuenow={chatPanelWidth}');
    expect(appShell).toContain('aria-valuetext={`Edit Agent chat ${chatPanelWidth} pixels`}');
    expect(appShell).toContain('aria-controls="app-shell-workspace app-shell-agent-chat"');
    expect(appShell).toContain('setPointerCapture(event.pointerId)');
    expect(appShell).toContain('releasePointerCapture(event.pointerId)');
    expect(appShell).toContain("event.key === 'Escape'");
    expect(appShell).toContain('dragOriginRef.current = null;');
    expect(styles).toContain('.agent-chat-resize-splitter');
    expect(styles).toContain('cursor: col-resize;');
  });

  it('persists chat layout separately from the editor layout preference key', async () => {
    const [layout, hook] = await Promise.all([readSource(AGENT_LAYOUT_SOURCE_URL), readSource(AGENT_LAYOUT_HOOK_SOURCE_URL)]);

    expect(layout).toContain("AGENT_CHAT_LAYOUT_STORAGE_KEY = 'openvideo-agent-chat-layout'");
    expect(layout).not.toContain('window-loom-editor-layout');
    expect(hook).toContain('window.localStorage.getItem(AGENT_CHAT_LAYOUT_STORAGE_KEY)');
    expect(hook).toContain('window.localStorage.setItem(AGENT_CHAT_LAYOUT_STORAGE_KEY');
    expect(hook).toContain('parseAgentChatLayoutPreference');
    expect(hook).toContain('serializeAgentChatLayoutPreference');
  });

  it('passes only a safe selected project asset candidate into the persistent AgentChatPanel', async () => {
    const [app, appShell, panel] = await Promise.all([
      readSource(APP_SOURCE_URL),
      readSource(APP_SHELL_SOURCE_URL),
      readSource(AGENT_PANEL_SOURCE_URL)
    ]);

    expect(app).toContain('const selectedContextAsset = useMemo<EditAgentContextAsset | null>(() => {');
    expect(app).toContain('projectId: editor.project.id,');
    expect(app).toContain('assetId: editor.selectedAsset.id,');
    expect(app).toContain('label: editor.selectedAsset.displayName,');
    expect(app).toContain('mediaKind: editor.selectedAsset.kind,');
    expect(app).toContain('durationMs: editor.selectedAsset.metadata.durationMs');
    expect(app).not.toContain('projectRelativePath');
    expect(app).not.toContain('mimeType');
    expect(app).not.toContain('byteLength');
    expect(appShell).toContain('readonly selectedContextAsset: EditAgentContextAsset | null;');
    expect(appShell).toContain('<AgentChatPanel selectedContextAsset={selectedContextAsset} width={chatPanelWidth} />');
    expect(panel).toContain('readonly selectedContextAsset: EditAgentContextAsset | null;');
    expect(panel).toContain('readonly width: number;');
    expect(panel).toContain('attachContextAsset(selectedContextAsset);');
    expect(panel).toContain('disabled={isBusy}');
  });

  it('locks only the non-chat workspace while an agent turn is in flight', async () => {
    const [appShell, context, styles] = await Promise.all([
      readSource(APP_SHELL_SOURCE_URL),
      readSource(AGENT_CONTEXT_SOURCE_URL),
      readSource(STYLES_SOURCE_URL)
    ]);

    expect(context).toContain('readonly isBusy: boolean;');
    expect(context).toContain('try {');
    expect(context).toContain('catch (cause) {');
    expect(context).toContain('finally {');
    expect(context).toContain('setIsBusy(false);');
    expect(appShell).toContain('aria-busy={isBusy}');
    expect(appShell).toContain('inert={isBusy}');
    expect(appShell).toContain('aria-live="polite"');
    expect(appShell).toContain('className="agent-workspace-lock__message" aria-hidden="true"');
    expect(appShell).toContain('className="agent-workspace-lock__announcement"');
    expect(styles).toContain('.agent-workspace-lock');
    expect(styles).toContain('.agent-workspace-lock__message');
  });
});
