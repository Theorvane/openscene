import { useEffect, useRef, type CSSProperties, type FormEvent, type ReactElement } from 'react';

import { useAgentChat } from './AgentChatContext';
import { AgentChatMessageView } from './AgentChatMessageView';
import { AgentChatSessionPicker } from './AgentChatSessionPicker';
import { AgentModelPicker } from './AgentModelPicker';
import { Button } from './ui';

type AgentChatPanelProps = {
  readonly width: number;
  readonly onCollapse: () => void;
};

type AgentChatPanelStyle = CSSProperties & {
  readonly '--agent-chat-panel-width': string;
};

export function AgentChatPanel({ width, onCollapse }: AgentChatPanelProps): ReactElement {
  const {
    selectedModel,
    isLocalModel,
    modelReady,
    input,
    setInput,
    messages,
    pendingApproval,
    status,
    error,
    isBusy,
    reasoningEffort,
    setReasoningEffort,
    activeProject,
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

  const panelStyle: AgentChatPanelStyle = { '--agent-chat-panel-width': `${width}px` };

  return (
    <aside id="app-shell-agent-chat" className="agent-chat-panel-shell" aria-label="OpenVideo agent chat" style={panelStyle}>
      <div className="agent-chat-panel">
        <div className="agent-chat-panel__header">
          <div className="agent-chat-panel__title">
            <p className="agent-chat-panel__title-label">OpenVideo Edit Agent</p>
            <span className="agent-chat-panel__title-meta">
              {selectedModel.label} · {selectedModel.providerLabel} · {isLocalModel ? 'Local' : modelReady ? 'Connected' : 'Not connected'}
            </span>
          </div>
          <div className="agent-chat-panel__actions">
            <Button variant="ghost" onClick={resetConversation} disabled={isBusy} title="Reset conversation" aria-label="Reset conversation">
              Reset
            </Button>
            <Button
              variant="ghost"
              onClick={onCollapse}
              title="Collapse agent chat"
              aria-label="Collapse agent chat sidebar"
              aria-controls="app-shell-agent-chat"
              aria-expanded={true}
            >
              ⇥
            </Button>
          </div>
        </div>

        {/* Sessions are per project, so work can be split across conversations. */}
        <div className="agent-chat-panel__sessions">
          <AgentChatSessionPicker />
        </div>

        {/* Project scope: every conversation operates on the active project. */}
        <div className="agent-chat-project-scope">
          {activeProject === null ? (
            <span className="agent-chat-project-scope__empty">Open a project to give the agent project scope.</span>
          ) : (
            <>
              <span className="agent-chat-project-scope__eyebrow">Project scope</span>
              <span className="agent-chat-project-scope__name">{activeProject.name}</span>
              <span className="agent-chat-project-scope__meta">
                {activeProject.assetCount} assets · {activeProject.trackCount} tracks
              </span>
            </>
          )}
        </div>

        <div className="agent-chat-log" aria-live="polite">

          {!modelReady && (
            <div className="agent-chat-hint-card agent-chat-hint-card--warning">
              <span className="agent-chat-hint-card__icon">⚠️</span>
              <p className="agent-chat-hint-card__text">
                {selectedModel.providerLabel} is not connected. Connect it in Settings → Providers, or pick a local model below.
              </p>
            </div>
          )}

          {messages.length === 0 && (
            <div className="agent-chat-hint-card agent-chat-hint-card--welcome">
              <span className="agent-chat-hint-card__icon">✦</span>
              <p className="agent-chat-hint-card__text">
                Ask the agent to generate video or speech, add a clip to the timeline, check a job, or export a project. Changes ask for approval before they run.
              </p>
            </div>
          )}

          {messages.map((message) => (
            <AgentChatMessageView key={message.id} message={message} />
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
          <div className="agent-chat-prompt-card">
            <textarea
              className="agent-chat-panel__input agent-chat-prompt-card__textarea"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  if (!isBusy && modelReady && pendingApproval === null && input.trim().length > 0) {
                    void sendMessage(input);
                  }
                }
              }}
              placeholder={pendingApproval ? 'Respond to the approval above first...' : 'Tell OpenVideo what to do…'}
              aria-label="Edit Agent prompt"
              disabled={isBusy || !modelReady || pendingApproval !== null}
              rows={2}
            />
            <div className="agent-chat-prompt-card__toolbar">
              <div className="agent-chat-prompt-card__meta">
                <AgentModelPicker reasoningEffort={reasoningEffort} onReasoningEffortChange={setReasoningEffort} />
              </div>
              <Button
                type="submit"
                variant="primary"
                disabled={isBusy || !modelReady || pendingApproval !== null || input.trim().length === 0}
                aria-label="Send Edit Agent prompt"
              >
                {isBusy ? 'Working…' : 'Send'}
              </Button>
            </div>
          </div>
        </form>
      </div>
    </aside>
  );
}
