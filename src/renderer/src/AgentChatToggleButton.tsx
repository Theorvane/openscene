import type { ReactElement } from 'react';
import { useAgentChat } from './AgentChatContext';

export function AgentChatToggleButton(): ReactElement {
  const { isOpen, toggleOpen } = useAgentChat();

  return (
    <button
      type="button"
      className={`agent-chat-toggle${isOpen ? ' agent-chat-toggle--active' : ''}`}
      onClick={toggleOpen}
      aria-pressed={isOpen}
    >
      Agent
    </button>
  );
}
