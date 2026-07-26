import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

const AGENT_CONTEXT_URL = new URL('../src/renderer/src/AgentChatContext.tsx', import.meta.url);
const AGENT_PANEL_URL = new URL('../src/renderer/src/AgentChatPanel.tsx', import.meta.url);
const TIMELINE_URL = new URL('../src/renderer/src/editor/TimelineEditor.tsx', import.meta.url);

describe('Edit Agent workspace wiring', () => {
  it('uses the independent edit-agent model and exposes approved project-asset context only', async () => {
    const [context, panel, timeline] = await Promise.all([
      readFile(AGENT_CONTEXT_URL, 'utf8'),
      readFile(AGENT_PANEL_URL, 'utf8'),
      readFile(TIMELINE_URL, 'utf8')
    ]);

    expect(context).toContain("getSelectedDomainModel('edit-agent')");
    expect(context).toContain('attachContextAsset');
    expect(panel).toContain('domain="edit-agent"');
    expect(panel).toContain('Project context');
    expect(timeline).toContain('Add selected asset to Edit Agent');
    expect(timeline).toContain('attachContextAsset');
  });
});
