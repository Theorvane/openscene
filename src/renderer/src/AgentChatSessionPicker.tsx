import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactElement } from 'react';
import { createPortal } from 'react-dom';

import { useAgentChat } from './AgentChatContext';
import { activeAgentChatSessionTitle } from './agentChatSessions';
import { formatAgentChatTime } from './agentChatHistoryView';

const POPOVER_WIDTH_PX = 280;

/**
 * Session switcher for the chat panel: conversations are kept per project, so
 * work can be split across several and picked up again. The popover renders
 * through a body portal because the panel clips overflow.
 */
export function AgentChatSessionPicker(): ReactElement {
  const { sessions, startNewSession, switchSession, isBusy, activeProject } = useAgentChat();
  const [isOpen, setIsOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const [anchorStyle, setAnchorStyle] = useState<CSSProperties>({});

  useLayoutEffect(() => {
    if (!isOpen) return;
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect === undefined) return;
    setAnchorStyle({
      position: 'fixed',
      top: `${rect.bottom + 6}px`,
      left: `${Math.min(Math.max(8, rect.left), Math.max(8, window.innerWidth - POPOVER_WIDTH_PX - 8))}px`
    });
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const onPointerDown = (event: MouseEvent): void => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target) === true || popoverRef.current?.contains(target) === true) return;
      setIsOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setIsOpen(false);
    };
    window.addEventListener('mousedown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [isOpen]);

  const popover = (
    <div
      id="agent-chat-session-popover"
      ref={popoverRef}
      className="agent-chat-session-picker__popover"
      role="listbox"
      aria-label="Chat sessions in this project"
      style={anchorStyle}
    >
      {sessions.map((session) => (
        <button
          key={session.conversationId}
          type="button"
          role="option"
          aria-selected={session.isActive}
          className={`agent-chat-session-picker__option${session.isActive ? ' agent-chat-session-picker__option--active' : ''}`}
          disabled={isBusy}
          onClick={() => {
            void switchSession(session.conversationId);
            setIsOpen(false);
          }}
        >
          <span className="agent-chat-session-picker__option-title">{session.title}</span>
          <span className="agent-chat-session-picker__option-meta">
            {session.updatedAt.length === 0 ? 'unsaved' : formatAgentChatTime(session.updatedAt)}
          </span>
        </button>
      ))}
      {activeProject === null && (
        <p className="agent-chat-session-picker__hint">Open a project to keep sessions with it.</p>
      )}
    </div>
  );

  return (
    <div className="agent-chat-session-picker">
      <button
        type="button"
        ref={triggerRef}
        className="agent-chat-session-picker__trigger"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls="agent-chat-session-popover"
        title="Switch chat session"
        onClick={() => setIsOpen((open) => !open)}
      >
        <span className="agent-chat-session-picker__trigger-label">{activeAgentChatSessionTitle(sessions)}</span>
        <span aria-hidden="true" className="agent-chat-session-picker__trigger-caret">▾</span>
      </button>
      <button
        type="button"
        className="agent-chat-session-picker__new"
        disabled={isBusy}
        title="Start a new chat session"
        aria-label="Start a new chat session"
        onClick={startNewSession}
      >
        ＋
      </button>
      {isOpen && createPortal(popover, document.body)}
    </div>
  );
}
