import { useEffect, useRef, type CSSProperties, type FormEvent, type ReactElement } from 'react';

import type { EditAgentContextAsset } from '../../shared/editAgentContext';
import { useAgentChat } from './AgentChatContext';
import { AiDomainModelSelector } from './AiDomainModelSelector';
import { Button } from './ui';

type AgentChatPanelProps = {
  readonly selectedContextAsset: EditAgentContextAsset | null;
  readonly width: number;
};

type AgentChatPanelStyle = CSSProperties & {
  readonly '--agent-chat-panel-width': string;
};

export function AgentChatPanel({ selectedContextAsset, width }: AgentChatPanelProps): ReactElement {
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
    contextAssets,
    attachContextAsset,
    removeContextAsset,
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

  const attachSelectedContextAsset = (): void => {
    if (selectedContextAsset === null) return;
    attachContextAsset(selectedContextAsset);
  };

  const selectedContextIsAttached = selectedContextAsset !== null
    && contextAssets.some((asset) => asset.projectId === selectedContextAsset.projectId && asset.assetId === selectedContextAsset.assetId);
  const panelStyle: AgentChatPanelStyle = { '--agent-chat-panel-width': `${width}px` };

  return (
    <aside id="app-shell-agent-chat" className="agent-chat-panel-shell" aria-label="OpenVideo agent chat" style={panelStyle}>
      <div className="agent-chat-panel">
        <div className="agent-chat-panel__header">
          <div className="agent-chat-panel__title">
            <p className="agent-chat-panel__title-label">OpenVideo Edit Agent</p>
            <span className="agent-chat-panel__title-meta">
              {selectedModel.label} · {isLocalModel ? 'Local · Ollama' : 'Select an available editing model'}
            </span>
          </div>
          <AiDomainModelSelector domain="edit-agent" label="Edit model" description="Local connection for chat-controlled edits." />
          <div className="agent-chat-panel__actions">
            <Button variant="ghost" onClick={resetConversation} disabled={isBusy} title="Reset conversation" aria-label="Reset conversation">
              Reset
            </Button>
          </div>
        </div>

        <div className="agent-chat-log" aria-live="polite">
          <section className="agent-chat-context" aria-label="Edit Agent asset context">
            <p className="agent-chat-context__title">Project context</p>
            {selectedContextAsset !== null && (
              <div className="agent-chat-context__candidate">
                <span className="agent-chat-context__eyebrow">Selected asset</span>
                <span className="agent-chat-context__name">{selectedContextAsset.label}</span>
                <span className="agent-chat-context__meta">{selectedContextAsset.mediaKind}</span>
                <Button
                  variant="ghost"
                  onClick={attachSelectedContextAsset}
                  disabled={isBusy || selectedContextIsAttached}
                  aria-label={`Attach ${selectedContextAsset.label} to Edit Agent context`}
                >
                  {selectedContextIsAttached ? 'Attached' : 'Attach'}
                </Button>
              </div>
            )}
            {contextAssets.length === 0 ? (
              <p className="agent-chat-log__hint">Import an AI voice or video result, then add its project asset here before asking for an edit.</p>
            ) : (
              <ul className="agent-chat-context__assets">
                {contextAssets.map((asset) => (
                  <li key={`${asset.projectId}:${asset.assetId}`}>
                    <span>
                      <span className="agent-chat-context__name">{asset.label}</span>
                      <span className="agent-chat-context__meta">{asset.mediaKind}</span>
                    </span>
                    <Button
                      variant="ghost"
                      onClick={() => removeContextAsset(asset.projectId, asset.assetId)}
                      disabled={isBusy}
                      aria-label={`Remove ${asset.label} from Edit Agent context`}
                    >
                      Remove
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </section>
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
            aria-label="Edit Agent prompt"
            disabled={isBusy || !isLocalModel || pendingApproval !== null}
          />
          <Button
            type="submit"
            variant="primary"
            disabled={isBusy || !isLocalModel || pendingApproval !== null || input.trim().length === 0}
            aria-label="Send Edit Agent prompt"
          >
            {isBusy ? 'Working…' : 'Send'}
          </Button>
        </form>
      </div>
    </aside>
  );
}
