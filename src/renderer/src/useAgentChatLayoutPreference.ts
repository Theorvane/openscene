import { useState } from 'react';

import {
  AGENT_CHAT_LAYOUT_DEFAULT_PREFERENCE,
  AGENT_CHAT_LAYOUT_STORAGE_KEY,
  parseAgentChatLayoutPreference,
  serializeAgentChatLayoutPreference,
  type AgentChatLayoutPreference
} from './agentChatLayoutPreferences';

type AgentChatLayoutPreferenceUpdater = (currentPreference: AgentChatLayoutPreference) => AgentChatLayoutPreference;

type UseAgentChatLayoutPreferenceResult = {
  readonly layoutPreference: AgentChatLayoutPreference;
  readonly updateLayoutPreference: (updater: AgentChatLayoutPreferenceUpdater) => void;
};

function isDomStorageError(error: unknown): boolean {
  return typeof DOMException !== 'undefined' && error instanceof DOMException;
}

function getStoredAgentChatLayoutPreference(): AgentChatLayoutPreference {
  if (typeof window === 'undefined') return AGENT_CHAT_LAYOUT_DEFAULT_PREFERENCE;

  try {
    return parseAgentChatLayoutPreference(window.localStorage.getItem(AGENT_CHAT_LAYOUT_STORAGE_KEY));
  } catch (error) {
    if (isDomStorageError(error)) return AGENT_CHAT_LAYOUT_DEFAULT_PREFERENCE;
    throw error;
  }
}

function persistAgentChatLayoutPreference(preference: AgentChatLayoutPreference): void {
  if (typeof window === 'undefined') return;

  try {
    window.localStorage.setItem(AGENT_CHAT_LAYOUT_STORAGE_KEY, serializeAgentChatLayoutPreference(preference));
  } catch (error) {
    if (!isDomStorageError(error)) throw error;
  }
}

export function useAgentChatLayoutPreference(): UseAgentChatLayoutPreferenceResult {
  const [layoutPreference, setLayoutPreference] = useState<AgentChatLayoutPreference>(() => getStoredAgentChatLayoutPreference());

  const updateLayoutPreference = (updater: AgentChatLayoutPreferenceUpdater): void => {
    setLayoutPreference((currentPreference) => {
      const nextPreference = updater(currentPreference);
      persistAgentChatLayoutPreference(nextPreference);
      return nextPreference;
    });
  };

  return { layoutPreference, updateLayoutPreference };
}
