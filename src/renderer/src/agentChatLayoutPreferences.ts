export const AGENT_CHAT_LAYOUT_STORAGE_KEY = 'openvideo-agent-chat-layout';
export const AGENT_CHAT_LAYOUT_SCHEMA_VERSION = 1;
export const AGENT_CHAT_LAYOUT_MIN_WIDTH = 300;
export const AGENT_CHAT_LAYOUT_MAX_WIDTH = 520;
export const AGENT_CHAT_LAYOUT_DEFAULT_WIDTH = 360;
export const AGENT_CHAT_LAYOUT_MIN_WORKSPACE_WIDTH = 620;

const AGENT_CHAT_LAYOUT_ARROW_STEP = 16;
const AGENT_CHAT_LAYOUT_SHIFT_STEP = 48;

export type AgentChatLayoutPreference = {
  readonly schemaVersion: typeof AGENT_CHAT_LAYOUT_SCHEMA_VERSION;
  readonly chatPanelWidth: number;
};

export type AgentChatPanelResizeKeyInput = {
  readonly currentWidth: number;
  readonly key: string;
  readonly shiftKey: boolean;
};

export const AGENT_CHAT_LAYOUT_DEFAULT_PREFERENCE: AgentChatLayoutPreference = {
  schemaVersion: AGENT_CHAT_LAYOUT_SCHEMA_VERSION,
  chatPanelWidth: AGENT_CHAT_LAYOUT_DEFAULT_WIDTH
};

function isStoredPreferenceRecord(value: unknown): value is { readonly schemaVersion?: unknown; readonly chatPanel?: unknown } {
  return typeof value === 'object' && value !== null;
}

function isStoredChatPanelRecord(value: unknown): value is { readonly width?: unknown } {
  return typeof value === 'object' && value !== null;
}

export function clampAgentChatPanelWidth(width: number, containerWidth?: number): number {
  const roundedWidth = Math.round(width);
  const widthPreservingWorkspace = containerWidth === undefined || containerWidth < AGENT_CHAT_LAYOUT_MIN_WORKSPACE_WIDTH + AGENT_CHAT_LAYOUT_MIN_WIDTH
    ? roundedWidth
    : Math.min(roundedWidth, containerWidth - AGENT_CHAT_LAYOUT_MIN_WORKSPACE_WIDTH);

  return Math.min(AGENT_CHAT_LAYOUT_MAX_WIDTH, Math.max(AGENT_CHAT_LAYOUT_MIN_WIDTH, widthPreservingWorkspace));
}

export function parseAgentChatLayoutPreference(storedPreference: string | null | undefined): AgentChatLayoutPreference {
  if (storedPreference === null || storedPreference === undefined) return AGENT_CHAT_LAYOUT_DEFAULT_PREFERENCE;

  try {
    const parsedPreference: unknown = JSON.parse(storedPreference);
    if (!isStoredPreferenceRecord(parsedPreference)) return AGENT_CHAT_LAYOUT_DEFAULT_PREFERENCE;
    if (parsedPreference.schemaVersion !== AGENT_CHAT_LAYOUT_SCHEMA_VERSION) return AGENT_CHAT_LAYOUT_DEFAULT_PREFERENCE;
    if (!isStoredChatPanelRecord(parsedPreference.chatPanel)) return AGENT_CHAT_LAYOUT_DEFAULT_PREFERENCE;
    if (typeof parsedPreference.chatPanel.width !== 'number' || !Number.isFinite(parsedPreference.chatPanel.width)) return AGENT_CHAT_LAYOUT_DEFAULT_PREFERENCE;

    return {
      schemaVersion: AGENT_CHAT_LAYOUT_SCHEMA_VERSION,
      chatPanelWidth: clampAgentChatPanelWidth(parsedPreference.chatPanel.width)
    };
  } catch (error) {
    if (error instanceof SyntaxError) return AGENT_CHAT_LAYOUT_DEFAULT_PREFERENCE;
    throw error;
  }
}

export function serializeAgentChatLayoutPreference(preference: AgentChatLayoutPreference): string {
  return JSON.stringify({
    schemaVersion: AGENT_CHAT_LAYOUT_SCHEMA_VERSION,
    chatPanel: {
      width: clampAgentChatPanelWidth(preference.chatPanelWidth)
    }
  });
}

export function getNextAgentChatPanelWidthFromKey({ currentWidth, key, shiftKey }: AgentChatPanelResizeKeyInput): number | null {
  const step = shiftKey ? AGENT_CHAT_LAYOUT_SHIFT_STEP : AGENT_CHAT_LAYOUT_ARROW_STEP;

  switch (key) {
    case 'ArrowLeft':
      return clampAgentChatPanelWidth(currentWidth + step);
    case 'ArrowRight':
      return clampAgentChatPanelWidth(currentWidth - step);
    case 'Home':
      return AGENT_CHAT_LAYOUT_MIN_WIDTH;
    case 'End':
      return AGENT_CHAT_LAYOUT_MAX_WIDTH;
    case 'Enter':
      return AGENT_CHAT_LAYOUT_DEFAULT_WIDTH;
    default:
      return null;
  }
}
