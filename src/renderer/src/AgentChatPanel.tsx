import { useEffect, useRef, type ReactElement } from 'react';
import { useAgentChat } from './AgentChatContext';

const PANEL_WIDTH = '380px';

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
    <div
      style={{
        width: isOpen ? PANEL_WIDTH : '0px',
        flexShrink: 0,
        overflow: 'hidden',
        transition: 'width 180ms ease'
      }}
    >
      <div
        style={{
          width: PANEL_WIDTH,
          height: '100%',
          background: 'var(--card)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-md)',
          boxShadow: 'var(--shadow-panel)',
          display: 'flex',
          flexDirection: 'column'
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '10px 12px',
            borderBottom: '1px solid var(--border)'
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={{ fontSize: 'var(--text-small)', fontWeight: 700 }}>OpenVideo Agent</span>
            <span style={{ fontSize: 'var(--text-micro)', color: 'var(--muted-foreground)' }}>
              {selectedModel.label} · {isLocalModel ? 'Local (Ollama)' : 'Not local — switch model'}
            </span>
          </div>
          <div style={{ display: 'flex', gap: '6px' }}>
            <button
              type="button"
              onClick={resetConversation}
              disabled={isBusy}
              title="Reset conversation"
              style={{ background: 'none', border: 'none', color: 'var(--muted-foreground)', cursor: 'pointer', fontSize: '12px' }}
            >
              ↺
            </button>
            <button
              type="button"
              onClick={closeOpen}
              style={{ background: 'none', border: 'none', color: 'var(--muted-foreground)', cursor: 'pointer', fontSize: '12px' }}
            >
              ✕
            </button>
          </div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {!isLocalModel && (
            <div style={{ fontSize: 'var(--text-micro)', color: 'var(--danger)' }}>
              Agent chat only runs against a local Ollama model right now. Pick a Local Engine model above to use it.
            </div>
          )}

          {messages.length === 0 && (
            <div style={{ fontSize: 'var(--text-micro)', color: 'var(--muted-foreground)' }}>
              Ask the agent to check a job, generate local AI video/speech, add a clip to the timeline, or export the
              project. Actions that change your project ask for your approval first.
            </div>
          )}

          {messages.map((message) => (
            <div
              key={message.id}
              style={{
                alignSelf: message.role === 'user' ? 'flex-end' : 'flex-start',
                maxWidth: '88%',
                padding: '6px 9px',
                borderRadius: 'var(--radius-xs)',
                fontSize: 'var(--text-micro)',
                background:
                  message.role === 'user'
                    ? 'var(--primary)'
                    : message.role === 'tool'
                      ? 'var(--surface-inset)'
                      : 'var(--surface-control)',
                color: message.role === 'user' ? '#fff' : 'var(--foreground)',
                whiteSpace: 'pre-wrap'
              }}
            >
              {message.role === 'tool' && (
                <div style={{ fontSize: '9px', opacity: 0.7, marginBottom: '2px' }}>Tool result · {message.toolName}</div>
              )}
              {message.text}
            </div>
          ))}

          {pendingApproval && (
            <div
              style={{
                padding: '8px 9px',
                borderRadius: 'var(--radius-xs)',
                border: '1px solid var(--primary)',
                background: 'var(--surface-inset)',
                fontSize: 'var(--text-micro)',
                display: 'flex',
                flexDirection: 'column',
                gap: '6px'
              }}
            >
              <div>
                Agent wants to run <strong>{pendingApproval.toolName}</strong>
              </div>
              <pre
                style={{
                  margin: 0,
                  fontSize: '9px',
                  whiteSpace: 'pre-wrap',
                  color: 'var(--muted-foreground)',
                  fontFamily: 'var(--font-mono)'
                }}
              >
                {JSON.stringify(pendingApproval.args, null, 2)}
              </pre>
              <div style={{ display: 'flex', gap: '6px' }}>
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={() => respondToApproval('approve')}
                  style={{
                    flex: 1,
                    padding: '5px 0',
                    borderRadius: 'var(--radius-xs)',
                    border: 'none',
                    background: 'var(--primary)',
                    color: '#fff',
                    cursor: 'pointer',
                    fontSize: 'var(--text-micro)',
                    fontWeight: 600
                  }}
                >
                  Run
                </button>
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={() => respondToApproval('deny')}
                  style={{
                    flex: 1,
                    padding: '5px 0',
                    borderRadius: 'var(--radius-xs)',
                    border: '1px solid var(--border)',
                    background: 'transparent',
                    color: 'var(--foreground)',
                    cursor: 'pointer',
                    fontSize: 'var(--text-micro)',
                    fontWeight: 600
                  }}
                >
                  Deny
                </button>
              </div>
            </div>
          )}

          {status === 'thinking' && <div style={{ fontSize: 'var(--text-micro)', color: 'var(--muted-foreground)' }}>Thinking…</div>}
          {error && <div style={{ fontSize: 'var(--text-micro)', color: 'var(--danger)' }}>{error}</div>}
          <div ref={listEndRef} />
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            sendMessage(input);
          }}
          style={{ display: 'flex', gap: '6px', padding: '10px 12px', borderTop: '1px solid var(--border)' }}
        >
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={pendingApproval ? 'Respond to the approval above first…' : 'Message the agent...'}
            disabled={isBusy || !isLocalModel || pendingApproval !== null}
            style={{
              flex: 1,
              padding: '6px 8px',
              borderRadius: 'var(--radius-xs)',
              border: '1px solid var(--border)',
              background: 'var(--input)',
              color: 'var(--foreground)',
              fontSize: 'var(--text-micro)'
            }}
          />
          <button
            type="submit"
            disabled={isBusy || !isLocalModel || pendingApproval !== null || input.trim().length === 0}
            style={{
              padding: '6px 10px',
              borderRadius: 'var(--radius-xs)',
              border: 'none',
              background: 'var(--primary)',
              color: '#fff',
              cursor: 'pointer',
              fontSize: 'var(--text-micro)',
              fontWeight: 600
            }}
          >
            {isBusy ? '...' : 'Send'}
          </button>
        </form>
      </div>
    </div>
  );
}
