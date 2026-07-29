import type { ReactElement, ReactNode } from 'react';

import type { AgentChatDisplayMessage } from '../../shared/agentChat';
import {
  describeAgentChatToolResult,
  parseAgentChatMarkdown,
  type AgentChatInline
} from './agentChatTranscript';

const ROLE_LABELS: Readonly<Record<'user' | 'assistant', string>> = {
  user: 'You',
  assistant: 'Agent'
};

const TOOL_STATUS_ICONS: Readonly<Record<string, string>> = {
  ok: '✓',
  failed: '✕',
  unknown: '·'
};

function renderInline(spans: readonly AgentChatInline[]): ReactNode {
  return spans.map((span, index) => {
    if (span.kind === 'strong') return <strong key={index}>{span.value}</strong>;
    if (span.kind === 'code') {
      return (
        <code key={index} className="agent-chat-message__code">
          {span.value}
        </code>
      );
    }
    return <span key={index}>{span.value}</span>;
  });
}

function AgentChatMarkdown({ text }: { readonly text: string }): ReactElement {
  return (
    <div className="agent-chat-message__body">
      {parseAgentChatMarkdown(text).map((block, index) => {
        if (block.kind === 'code') {
          return (
            <pre key={index} className="agent-chat-message__pre">
              <code>{block.value}</code>
            </pre>
          );
        }
        if (block.kind === 'bullets' || block.kind === 'ordered') {
          const items = block.items.map((spans, itemIndex) => <li key={itemIndex}>{renderInline(spans)}</li>);
          return block.kind === 'bullets' ? (
            <ul key={index} className="agent-chat-message__list">
              {items}
            </ul>
          ) : (
            <ol key={index} className="agent-chat-message__list">
              {items}
            </ol>
          );
        }
        return (
          <p key={index} className="agent-chat-message__text">
            {renderInline(block.spans)}
          </p>
        );
      })}
    </div>
  );
}

/**
 * One transcript row. Assistant and user turns render the agent's markdown as
 * real structure; tool turns collapse to a single status row so a JSON payload
 * never floods the conversation, and expand on demand.
 */
export function AgentChatMessageView({ message }: { readonly message: AgentChatDisplayMessage }): ReactElement {
  if (message.role === 'tool') {
    const result = describeAgentChatToolResult(message.text);
    return (
      <details className={`agent-chat-tool agent-chat-tool--${result.status}`}>
        <summary className="agent-chat-tool__summary">
          <span aria-hidden="true" className="agent-chat-tool__status">
            {TOOL_STATUS_ICONS[result.status]}
          </span>
          <span className="agent-chat-tool__name">{message.toolName ?? 'tool'}</span>
          <span className="agent-chat-tool__hint">{result.summary}</span>
        </summary>
        <pre className="agent-chat-tool__payload">{result.detail}</pre>
      </details>
    );
  }

  const role = message.role;
  return (
    <div className={`agent-chat-message agent-chat-message--${role}`}>
      <span className="agent-chat-message__role">{ROLE_LABELS[role]}</span>
      <AgentChatMarkdown text={message.text} />
    </div>
  );
}
