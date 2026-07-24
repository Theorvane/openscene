import { useEffect, useRef, useState, type ReactElement } from 'react';
import { createPortal } from 'react-dom';
import type { AgentChatDisplayMessage, AgentChatStatus, AgentToolCallProposal } from '../../shared/agentChat';
import { useLlmModel } from './LlmProviderContext';

function createConversationId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `conv-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function AgentChatPanel(): ReactElement {
  const { selectedModel, providerConfig } = useLlmModel();
  const conversationIdRef = useRef<string>(createConversationId());

  const [isOpen, setIsOpen] = useState(false);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<readonly AgentChatDisplayMessage[]>([]);
  const [pendingApproval, setPendingApproval] = useState<AgentToolCallProposal | null>(null);
  const [status, setStatus] = useState<AgentChatStatus>('idle');
  const [error, setError] = useState<string | undefined>(undefined);
  const [isBusy, setIsBusy] = useState(false);
  const listEndRef = useRef<HTMLDivElement | null>(null);

  const isLocalModel = selectedModel.providerId === 'local_ollama';

  useEffect(() => {
    listEndRef.current?.scrollIntoView({ block: 'end' });
  }, [messages, pendingApproval]);

  const sendMessage = async (text: string): Promise<void> => {
    if (text.trim().length === 0 || isBusy || !isLocalModel) return;

    setIsBusy(true);
    setError(undefined);
    setStatus('thinking');
    setInput('');

    const response = await window.videoTool.agentChatSend({
      conversationId: conversationIdRef.current,
      text,
      modelId: selectedModel.id,
      ollamaBaseUrl: providerConfig.ollamaBaseUrl
    });

    if (response.ok) {
      setMessages(response.value.messages);
      setPendingApproval(response.value.pendingApproval);
      setStatus(response.value.status);
      setError(response.value.error);
    } else {
      setStatus('error');
      setError(response.error.message);
    }
    setIsBusy(false);
  };

  const respondToApproval = async (decision: 'approve' | 'deny'): Promise<void> => {
    if (!pendingApproval || isBusy) return;

    setIsBusy(true);
    const response = await window.videoTool.agentChatApprove({
      conversationId: conversationIdRef.current,
      toolCallId: pendingApproval.toolCallId,
      decision
    });

    if (response.ok) {
      setMessages(response.value.messages);
      setPendingApproval(response.value.pendingApproval);
      setStatus(response.value.status);
      setError(response.value.error);
    } else {
      setStatus('error');
      setError(response.error.message);
    }
    setIsBusy(false);
  };

  const resetConversation = async (): Promise<void> => {
    if (isBusy) return;
    setIsBusy(true);
    await window.videoTool.agentChatReset({ conversationId: conversationIdRef.current });
    setMessages([]);
    setPendingApproval(null);
    setStatus('idle');
    setError(undefined);
    setIsBusy(false);
  };

  return (
    <div style={{ position: 'relative', display: 'inline-flex' }}>
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
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

      {isOpen &&
        createPortal(
          <>
            <div
              onClick={() => setIsOpen(false)}
              style={{ position: 'fixed', inset: 0, zIndex: 2000, background: 'rgba(0, 0, 0, 0.15)' }}
            />
            <div
              style={{
                position: 'fixed',
                top: 0,
                left: 0,
                bottom: 0,
                zIndex: 2001,
                width: '380px',
                background: 'var(--card)',
                borderRight: '1px solid var(--border)',
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
                    onClick={() => setIsOpen(false)}
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

                {status === 'thinking' && (
                  <div style={{ fontSize: 'var(--text-micro)', color: 'var(--muted-foreground)' }}>Thinking…</div>
                )}
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
          </>,
          document.body
        )}
    </div>
  );
}
