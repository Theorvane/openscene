/**
 * Transcript formatting rules for the Edit Agent chat log.
 *
 * The agent writes ordinary markdown and the tools return JSON, so a raw
 * `white-space: pre-wrap` paragraph shows literal `**asterisks**` and dumps a
 * whole tool payload into the conversation. These pure helpers turn both into
 * something the panel can render as structure: a minimal markdown subset
 * (paragraphs, lists, fenced code, bold, inline code) and a one-line tool
 * summary with the full payload kept for an expandable detail view.
 */

import type { AgentChatDisplayMessage } from '../../shared/agentChat';

/**
 * Keeps the user's turn on screen when a turn fails. The main process records
 * a message only once the graph accepts it, so a provider error can come back
 * with a transcript that never contains what was just typed.
 */
export function mergePendingUserMessage(
  serverMessages: readonly AgentChatDisplayMessage[],
  pending: AgentChatDisplayMessage
): readonly AgentChatDisplayMessage[] {
  const lastUserMessage = [...serverMessages].reverse().find((message) => message.role === 'user');
  return lastUserMessage?.text === pending.text ? serverMessages : [...serverMessages, pending];
}

export type AgentChatInline =
  | { readonly kind: 'text'; readonly value: string }
  | { readonly kind: 'strong'; readonly value: string }
  | { readonly kind: 'code'; readonly value: string };

export type AgentChatBlock =
  | { readonly kind: 'paragraph'; readonly spans: readonly AgentChatInline[] }
  | { readonly kind: 'bullets'; readonly items: readonly (readonly AgentChatInline[])[] }
  | { readonly kind: 'ordered'; readonly items: readonly (readonly AgentChatInline[])[] }
  | { readonly kind: 'code'; readonly value: string; readonly language?: string };

const FENCE_PATTERN = /^```(\w*)\s*$/;
const BULLET_PATTERN = /^\s*[-*]\s+(.*)$/;
const ORDERED_PATTERN = /^\s*\d+[.)]\s+(.*)$/;
/** Inline `code` and **bold**; anything else stays literal text. */
const INLINE_PATTERN = /`[^`\n]+`|\*\*[^*\n]+\*\*/g;

export function parseAgentChatInline(text: string): readonly AgentChatInline[] {
  const spans: AgentChatInline[] = [];
  let consumed = 0;
  for (const match of text.matchAll(INLINE_PATTERN)) {
    const index = match.index ?? 0;
    if (index > consumed) spans.push({ kind: 'text', value: text.slice(consumed, index) });
    const token = match[0];
    spans.push(
      token.startsWith('`')
        ? { kind: 'code', value: token.slice(1, -1) }
        : { kind: 'strong', value: token.slice(2, -2) }
    );
    consumed = index + token.length;
  }
  if (consumed < text.length) spans.push({ kind: 'text', value: text.slice(consumed) });
  return spans;
}

export function parseAgentChatMarkdown(text: string): readonly AgentChatBlock[] {
  const lines = text.split('\n');
  const blocks: AgentChatBlock[] = [];
  let paragraph: string[] = [];
  let list: { kind: 'bullets' | 'ordered'; items: string[] } | null = null;

  const flushParagraph = (): void => {
    if (paragraph.length === 0) return;
    // Joined with newlines so the panel keeps the agent's own line breaks.
    blocks.push({ kind: 'paragraph', spans: parseAgentChatInline(paragraph.join('\n')) });
    paragraph = [];
  };
  const flushList = (): void => {
    if (list === null) return;
    blocks.push({ kind: list.kind, items: list.items.map(parseAgentChatInline) });
    list = null;
  };
  const appendItem = (kind: 'bullets' | 'ordered', item: string): void => {
    flushParagraph();
    if (list === null || list.kind !== kind) {
      flushList();
      list = { kind, items: [] };
    }
    list.items.push(item);
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    const fence = FENCE_PATTERN.exec(line.trim());
    if (fence !== null) {
      flushParagraph();
      flushList();
      const language = fence[1] ?? '';
      const body: string[] = [];
      index += 1;
      while (index < lines.length && !(lines[index] ?? '').trim().startsWith('```')) {
        body.push(lines[index] ?? '');
        index += 1;
      }
      blocks.push({ kind: 'code', value: body.join('\n'), ...(language.length === 0 ? {} : { language }) });
      continue;
    }
    if (line.trim().length === 0) {
      flushParagraph();
      flushList();
      continue;
    }
    const bullet = BULLET_PATTERN.exec(line);
    if (bullet !== null) {
      appendItem('bullets', bullet[1] ?? '');
      continue;
    }
    const ordered = ORDERED_PATTERN.exec(line);
    if (ordered !== null) {
      appendItem('ordered', ordered[1] ?? '');
      continue;
    }
    flushList();
    paragraph.push(line);
  }
  flushParagraph();
  flushList();
  return blocks;
}

export type AgentChatToolStatus = 'ok' | 'failed' | 'unknown';

export interface AgentChatToolResult {
  readonly status: AgentChatToolStatus;
  /** One line for the collapsed row. */
  readonly summary: string;
  /** The full payload, pretty-printed when it is JSON. */
  readonly detail: string;
}

const SUMMARY_MAX_LENGTH = 90;

function truncate(text: string, limit: number): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  return collapsed.length <= limit ? collapsed : `${collapsed.slice(0, limit - 1)}…`;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Names the payload carries, so the collapsed row says what came back. */
function summarizeFields(record: Record<string, unknown>): string {
  const fields = Object.keys(record).filter((key) => key !== 'success');
  return fields.length === 0 ? 'no payload' : truncate(fields.join(', '), SUMMARY_MAX_LENGTH);
}

export function describeAgentChatToolResult(text: string): AgentChatToolResult {
  const trimmed = text.trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    const firstLine = trimmed.split('\n').find((line) => line.trim().length > 0) ?? '';
    return { status: 'unknown', summary: truncate(firstLine, SUMMARY_MAX_LENGTH), detail: trimmed };
  }
  if (!isPlainRecord(parsed)) {
    return { status: 'unknown', summary: truncate(trimmed, SUMMARY_MAX_LENGTH), detail: trimmed };
  }

  const success = parsed['success'];
  const error = parsed['error'];
  const failed = success === false || typeof error === 'string';
  return {
    status: success === true ? 'ok' : failed ? 'failed' : 'unknown',
    summary: typeof error === 'string' && error.trim().length > 0
      ? truncate(error, SUMMARY_MAX_LENGTH)
      : summarizeFields(parsed),
    detail: JSON.stringify(parsed, null, 2)
  };
}
