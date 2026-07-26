import { useEffect, useRef, type FormEvent, type ReactElement } from 'react';

import { useAgentChat } from './AgentChatContext';
import { Button } from './ui';

export function AgentChatPanel(): ReactElement {
  const {
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
  }, [messages, pendingApproval, status]);

  const submitMessage = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    void sendMessage(input);
  };

  return (
    <aside className="agent-chat-panel-shell" aria-label="OpenVideo agent chat">
      <div className="agent-chat-panel">
        <div className="agent-chat-panel__header">
          <div className="agent-chat-panel__title">
            <p className="agent-chat-panel__title-label">OpenVideo Agent</p>
            <span className="agent-chat-panel__title-meta">
              {selectedModel.label} · {isLocalModel ? 'Local · Ollama' : 'Switch to a local model'}
            </span>
          </div>
          <div className="agent-chat-panel__actions">
            <Button variant="ghost" onClick={resetConversation} disabled={isBusy} title="Reset conversation" aria-label="Reset conversation">
              Reset
            </Button>
          </div>
        </div>

        <div className="agent-chat-log" aria-live="polite">
          {!isLocalModel && (
            <p className="agent-chat-log__hint">
              Agent chat currently uses a local Ollama model. Pick a Local Engine model above to control OpenVideo with chat.
            </p>
          )}

          {messages.length === 0 && (
            <p className="agent-chat-log__hint">
              Ask the agent to generate video or speech, add a clip to the timeline, check a job, or export a project. Changes ask for approval before they run.
            </p>
          )}

          {messages.map((message) => (
            <div key={message.id} className={`agent-chat-message agent-chat-message--${message.role}`}>
              <span className="agent-chat-message__role">
                {message.role === 'tool' ? `Tool · ${message.toolName}` : message.role}
              </span>
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
                <Button variant="primary" disabled={isBusy} onClick={() => void respondToApproval('approve')}>
                  Run
                </Button>
                <Button variant="stop" disabled={isBusy} onClick={() => void respondToApproval('deny')}>
                  Deny
                </Button>
              </div>
            </div>
          )}

          {status === 'thinking' && <p className="agent-chat-status">Working through OpenVideo…</p>}
          {error && (
            <div className="status-card status-card--danger" role="status">
              {error}
            </div>
          )}
          <div ref={listEndRef} />
        </div>

        <form className="agent-chat-panel__form" onSubmit={submitMessage}>
          <input
            type="text"
            className="agent-chat-panel__input"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder={pendingApproval ? 'Respond to the approval above first...' : 'Tell OpenVideo what to do…'}
            disabled={isBusy || !isLocalModel || pendingApproval !== null}
          />
          <Button type="submit" variant="primary" disabled={isBusy || !isLocalModel || pendingApproval !== null || input.trim().length === 0}>
            {isBusy ? 'Working…' : 'Send'}
          </Button>
        </form>
      </div>
    </aside>
  );
}
