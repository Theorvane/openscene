import type { ReactElement } from 'react';
import { useAgentChat } from './AgentChatContext';

export function AgentChatToggleButton(): ReactElement {
  const { isOpen, toggleOpen } = useAgentChat();

  return (
    <button
      type="button"
      onClick={toggleOpen}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        padding: '4px 10px',
        background: isOpen ? 'var(--primary)' : 'var(--surface-control)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-xs)',
        color: isOpen ? '#fff' : 'var(--foreground)',
        cursor: 'pointer',
        fontSize: 'var(--text-micro)',
        fontWeight: 600,
        fontFamily: 'var(--font-mono)',
        transition: 'all 120ms ease'
      }}
    >
      <span>💬 Agent Chat</span>
    </button>
  );
}
