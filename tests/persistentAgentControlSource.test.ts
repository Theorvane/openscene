import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

const APP_SHELL_SOURCE_URL = new URL('../src/renderer/src/AppShell.tsx', import.meta.url);
const AGENT_PANEL_SOURCE_URL = new URL('../src/renderer/src/AgentChatPanel.tsx', import.meta.url);
const AGENT_CONTEXT_SOURCE_URL = new URL('../src/renderer/src/AgentChatContext.tsx', import.meta.url);
const STYLES_SOURCE_URL = new URL('../src/renderer/src/styles.css', import.meta.url);

async function readSource(url: URL): Promise<string> {
  return readFile(url, 'utf8');
}

describe('persistent agent control surface', () => {
  it('keeps agent chat visible beside every workspace and removes the toggle control', async () => {
    const [appShell, panel, styles] = await Promise.all([
      readSource(APP_SHELL_SOURCE_URL),
      readSource(AGENT_PANEL_SOURCE_URL),
      readSource(STYLES_SOURCE_URL)
    ]);

    expect(appShell).toContain('<AgentChatPanel />');
    expect(appShell).not.toContain('AgentChatToggleButton');
    expect(panel).not.toContain('isOpen');
    expect(panel).not.toContain('closeOpen');
    expect(styles).toContain('.agent-chat-panel-shell {');
    expect(styles).toContain('width: 360px;');
    expect(styles).not.toContain('.agent-chat-panel-shell--open');
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
