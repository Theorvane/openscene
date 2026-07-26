import { describe, expect, it } from 'vitest';
import { AGENT_CHAT_MUTATING_TOOL_NAMES } from '../src/main/agentChatTools';

describe('Edit Agent project inspection approval boundary', () => {
  it('keeps timeline inspection read-only while project writes require explicit approval', () => {
    expect(AGENT_CHAT_MUTATING_TOOL_NAMES.has('getProjectTimeline')).toBe(false);
    expect(AGENT_CHAT_MUTATING_TOOL_NAMES.has('addClipToTimeline')).toBe(true);
    expect(AGENT_CHAT_MUTATING_TOOL_NAMES.has('exportProjectVideo')).toBe(true);
  });
});
