import { useEffect, useRef, type ReactElement } from 'react';
import { Button } from './ui';
import { useAgentChat } from './AgentChatContext';

const PANEL_WIDTH = '360px';

export function AgentChatPanel(): ReactElement {
  const {
    isOpen,
    closeOpen,
    selectedModel,
    isLocalModel,
    input,
    setInput,
    messages,
    pendingApproval,
    status,
    error,
    isBusy,
    sendMessage,
    respondToApproval,
    resetConversation
  } = useAgentChat();

  const listEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    listEndRef.current?.scrollIntoView({ block: 'end' });
  }, [messages, pendingApproval]);

  return (
    <div style={{ width: isOpen ? PANEL_WIDTH : '0px', flexShrink: 0, overflow: 'hidden', transition: 'width 180ms ease' }}>
      <div className="agent-chat-panel" style={{ width: PANEL_WIDTH }}>
        <div className="agent-chat-panel__header">
          <div className="agent-chat-panel__title">
            <p className="agent-chat-panel__title-label">Agent</p>
            <span className="agent-chat-panel__title-meta">
              {selectedModel.label} · {isLocalModel ? 'Local · Ollama' : 'Switch to a local model'}
            </span>
          </div>
          <div className="agent-chat-panel__actions">
            <Button variant="ghost" onClick={resetConversation} disabled={isBusy} title="Reset conversation" aria-label="Reset conversation">
              ↺
            </Button>
            <Button variant="ghost" onClick={closeOpen} aria-label="Close agent chat">
              ✕
            </Button>
          </div>
        </div>

        <div className="agent-chat-log">
          {!isLocalModel && (
            <p className="agent-chat-log__hint">
              Agent chat only runs against a local Ollama model right now. Pick a Local Engine model above to use it.
            </p>
          )}

          {messages.length === 0 && (
            <p className="agent-chat-log__hint">
              Ask the agent to check a job, generate local AI video/speech, add a clip to the timeline, or export the
              project. Actions that change your project ask for your approval first.
            </p>
          )}

          {messages.map((message) => (
            <div key={message.id} className={`agent-chat-message agent-chat-message--${message.role}`}>
              <span className="agent-chat-message__role">{message.role === 'tool' ? `Tool · ${message.toolName}` : message.role}</span>
              <p className="agent-chat-message__text">{message.text}</p>
            </div>
          ))}

          {pendingApproval && (
            <div className="status-card agent-chat-approval" role="status">
              <p className="agent-chat-approval__tool">
                Run <strong>{pendingApproval.toolName}</strong>?
              </p>
              <pre className="agent-chat-approval__args">{JSON.stringify(pendingApproval.args, null, 2)}</pre>
              <div className="agent-chat-approval__actions">
                <Button variant="primary" disabled={isBusy} onClick={() => respondToApproval('approve')}>
                  Run
                </Button>
                <Button variant="stop" disabled={isBusy} onClick={() => respondToApproval('deny')}>
                  Deny
                </Button>
              </div>
            </div>
          )}

          {status === 'thinking' && <p className="agent-chat-status">Thinking…</p>}
          {error && (
            <div className="status-card status-card--danger" role="status">
              {error}
            </div>
          )}
          <div ref={listEndRef} />
        </div>

        <form
          className="agent-chat-panel__form"
          onSubmit={(e) => {
            e.preventDefault();
            sendMessage(input);
          }}
        >
          <input
            type="text"
            className="agent-chat-panel__input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={pendingApproval ? 'Respond to the approval above first…' : 'Message the agent…'}
            disabled={isBusy || !isLocalModel || pendingApproval !== null}
          />
          <Button type="submit" variant="primary" disabled={isBusy || !isLocalModel || pendingApproval !== null || input.trim().length === 0}>
            {isBusy ? '…' : 'Send'}
          </Button>
        </form>
      </div>
    </div>
  );
}
