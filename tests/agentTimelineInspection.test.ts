import { describe, expect, it } from 'vitest';
import { agentChatMutatingToolNames } from '../src/main/agentChatTools';
import { getOpenVideoMcpDefinition } from '../src/main/openVideoMcpServer';

// Derived from the server's real tools rather than from a list kept beside them:
// a mutating list that is written out by hand fails open, which is how four
// project writes shipped without ever asking. See `agentApprovalBoundary`.
const AGENT_CHAT_MUTATING_TOOL_NAMES = agentChatMutatingToolNames(
  (getOpenVideoMcpDefinition()?.tools ?? []).map((tool) => ({ name: tool.name }))
);

describe('Edit Agent project inspection approval boundary', () => {
  it('keeps timeline inspection read-only while project writes require explicit approval', () => {
    expect(AGENT_CHAT_MUTATING_TOOL_NAMES.has('getProjectTimeline')).toBe(false);
    expect(AGENT_CHAT_MUTATING_TOOL_NAMES.has('trimTimelineClip')).toBe(true);
    expect(AGENT_CHAT_MUTATING_TOOL_NAMES.has('updateClipEffects')).toBe(true);
    expect(AGENT_CHAT_MUTATING_TOOL_NAMES.has('addClipToTimeline')).toBe(true);
    expect(AGENT_CHAT_MUTATING_TOOL_NAMES.has('exportProjectVideo')).toBe(true);
  });
});
