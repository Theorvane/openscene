import { describe, expect, it } from 'vitest';

import {
  AGENT_CHAT_LAYOUT_DEFAULT_WIDTH,
  AGENT_CHAT_LAYOUT_MAX_WIDTH,
  AGENT_CHAT_LAYOUT_MIN_WIDTH,
  AGENT_CHAT_LAYOUT_MIN_WORKSPACE_WIDTH,
  AGENT_CHAT_LAYOUT_STORAGE_KEY,
  clampAgentChatPanelWidth,
  getNextAgentChatPanelWidthFromKey,
  parseAgentChatLayoutPreference,
  serializeAgentChatLayoutPreference
} from '../src/renderer/src/agentChatLayoutPreferences';

describe('agent chat layout preferences', () => {
  it('Given the approved storage key, When referenced, Then it stays separate from editor layout storage', () => {
    expect(AGENT_CHAT_LAYOUT_STORAGE_KEY).toBe('openvideo-agent-chat-layout');
  });

  it('Given missing or malformed storage, When parsed, Then the default chat width is used', () => {
    expect(parseAgentChatLayoutPreference(null)).toEqual({ schemaVersion: 1, chatPanelWidth: AGENT_CHAT_LAYOUT_DEFAULT_WIDTH, chatPanelCollapsed: false });
    expect(parseAgentChatLayoutPreference('{')).toEqual({ schemaVersion: 1, chatPanelWidth: AGENT_CHAT_LAYOUT_DEFAULT_WIDTH, chatPanelCollapsed: false });
    expect(parseAgentChatLayoutPreference(JSON.stringify({ schemaVersion: 1, chatPanel: { width: 'wide' } }))).toEqual({
      schemaVersion: 1,
      chatPanelWidth: AGENT_CHAT_LAYOUT_DEFAULT_WIDTH,
      chatPanelCollapsed: false
    });
  });

  it('Given stored chat widths outside the range, When parsed or serialized, Then values are integer-clamped', () => {
    expect(parseAgentChatLayoutPreference(JSON.stringify({ schemaVersion: 1, chatPanel: { width: 260.8 } }))).toEqual({
      schemaVersion: 1,
      chatPanelWidth: AGENT_CHAT_LAYOUT_MIN_WIDTH,
      chatPanelCollapsed: false
    });
    expect(parseAgentChatLayoutPreference(JSON.stringify({ schemaVersion: 1, chatPanel: { width: 640 } }))).toEqual({
      schemaVersion: 1,
      chatPanelWidth: AGENT_CHAT_LAYOUT_MAX_WIDTH,
      chatPanelCollapsed: false
    });
    expect(JSON.parse(serializeAgentChatLayoutPreference({ schemaVersion: 1, chatPanelWidth: 384.7, chatPanelCollapsed: false }))).toEqual({
      schemaVersion: 1,
      chatPanel: { width: 385, collapsed: false }
    });
    expect(parseAgentChatLayoutPreference(JSON.stringify({ schemaVersion: 1, chatPanel: { width: 360, collapsed: true } }))).toEqual({
      schemaVersion: 1,
      chatPanelWidth: 360,
      chatPanelCollapsed: true
    });
    expect(JSON.parse(serializeAgentChatLayoutPreference({ schemaVersion: 1, chatPanelWidth: 360, chatPanelCollapsed: true }))).toEqual({
      schemaVersion: 1,
      chatPanel: { width: 360, collapsed: true }
    });
  });

  it('Given container width, When clamped, Then workspace keeps 620px when possible and degrades safely below it', () => {
    expect(clampAgentChatPanelWidth(520, AGENT_CHAT_LAYOUT_MIN_WORKSPACE_WIDTH + 380)).toBe(380);
    expect(clampAgentChatPanelWidth(520, AGENT_CHAT_LAYOUT_MIN_WORKSPACE_WIDTH + AGENT_CHAT_LAYOUT_MIN_WIDTH)).toBe(AGENT_CHAT_LAYOUT_MIN_WIDTH);
    expect(clampAgentChatPanelWidth(520, 860)).toBe(AGENT_CHAT_LAYOUT_MAX_WIDTH);
  });

  it('Given splitter keyboard input, When Arrow, Shift, Home, End, or Enter is pressed, Then chat width follows the a11y contract', () => {
    expect(getNextAgentChatPanelWidthFromKey({ currentWidth: 360, key: 'ArrowLeft', shiftKey: false })).toBe(376);
    expect(getNextAgentChatPanelWidthFromKey({ currentWidth: 360, key: 'ArrowRight', shiftKey: false })).toBe(344);
    expect(getNextAgentChatPanelWidthFromKey({ currentWidth: 360, key: 'ArrowLeft', shiftKey: true })).toBe(408);
    expect(getNextAgentChatPanelWidthFromKey({ currentWidth: 360, key: 'ArrowRight', shiftKey: true })).toBe(312);
    expect(getNextAgentChatPanelWidthFromKey({ currentWidth: 360, key: 'Home', shiftKey: false })).toBe(AGENT_CHAT_LAYOUT_MIN_WIDTH);
    expect(getNextAgentChatPanelWidthFromKey({ currentWidth: 360, key: 'End', shiftKey: false })).toBe(AGENT_CHAT_LAYOUT_MAX_WIDTH);
    expect(getNextAgentChatPanelWidthFromKey({ currentWidth: 420, key: 'Enter', shiftKey: false })).toBe(AGENT_CHAT_LAYOUT_DEFAULT_WIDTH);
    expect(getNextAgentChatPanelWidthFromKey({ currentWidth: 420, key: 'Escape', shiftKey: false })).toBeNull();
  });
});
