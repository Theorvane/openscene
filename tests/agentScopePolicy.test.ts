import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import { AGENT_SCOPE_POLICY } from '../src/shared/agentScope';

/**
 * The assistant's scope is a rule, so it lives in the shared core and both
 * surfaces are held to the same one. A guardrail written twice is a guardrail
 * that drifts, and the surface it drifts on is the one nobody re-reads.
 */

const DESKTOP_GRAPH = new URL('../src/main/agentChatGraph.ts', import.meta.url);
const MOBILE_AGENT = new URL('../mobile/src/screens/AgentScreen.tsx', import.meta.url);

describe('agent scope policy', () => {
  it('says what is in scope, what is not, and how to decline', async () => {
    expect(AGENT_SCOPE_POLICY).toContain('Scope.');
    // Drawn around the work rather than around topics: a script or a shot name
    // serves the video even when no tool call follows it.
    expect(AGENT_SCOPE_POLICY).toContain('no tool call has to');
    expect(AGENT_SCOPE_POLICY).toContain('out of scope');
    // Declining has to leave the user somewhere to go, and has to be short.
    expect(AGENT_SCOPE_POLICY).toContain('in one sentence');
    expect(AGENT_SCOPE_POLICY).toContain('nearest thing you can actually do');
    expect(AGENT_SCOPE_POLICY).toContain('Do not lecture');
    // Declining and then answering anyway is the failure that makes a scope
    // instruction worthless.
    expect(AGENT_SCOPE_POLICY).toContain('do not answer the question anyway');
  });

  it('is carried by both surfaces from the shared core', async () => {
    const [desktop, mobile] = await Promise.all([
      readFile(DESKTOP_GRAPH, 'utf8'),
      readFile(MOBILE_AGENT, 'utf8')
    ]);

    expect(desktop).toContain("import { AGENT_SCOPE_POLICY } from '../shared/agentScope';");
    expect(desktop).toContain('AGENT_SCOPE_POLICY +');

    expect(mobile).toContain("import { AGENT_SCOPE_POLICY } from '@openvideo/shared/agentScope';");
    expect(mobile).toContain('AGENT_SCOPE_POLICY;');

    // Neither surface may restate it in its own words.
    expect(desktop).not.toContain('out of scope —');
    expect(mobile.split('AGENT_SCOPE_POLICY')[0]).not.toContain('Scope.');
  });
});
