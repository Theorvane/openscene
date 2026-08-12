/**
 * What a conversation is made of, what of it is worth keeping, and what it is
 * safe to drop.
 *
 * The transcript is not a flat list of turns. An assistant message that proposed
 * a tool call and the `tool` message answering it are a pair, and every provider
 * rejects the second without the first — so trimming an over-long history by
 * simply slicing the front produces a conversation that no longer sends. That is
 * the whole reason this is a function with tests rather than a `slice(-40)` at
 * the call site.
 *
 * The message shape lives here rather than beside the request that sends it.
 * A message is data and the client is transport, and putting the data in the
 * transport meant nothing could read a stored conversation without also pulling
 * in the keystore and the browser sign-in the client depends on — which is to
 * say, without being a phone. These rules are about a list of messages and
 * should be testable as such.
 */

export type ChatRole = 'system' | 'user' | 'assistant' | 'tool';

export type ToolCallProposal = {
  readonly id: string;
  readonly name: string;
  readonly args: Record<string, unknown>;
};

export type ChatMessage = {
  readonly role: ChatRole;
  readonly content: string;
  /** Set on assistant turns that proposed calls, and on the tool replies. */
  readonly toolCallId?: string;
  readonly toolName?: string;
  readonly proposals?: readonly ToolCallProposal[];
};

/**
 * How many messages survive.
 *
 * A cap rather than the whole history, because every turn re-sends all of it:
 * an unbounded transcript is a bill that grows with the length of the
 * conversation and eventually exceeds the model's context outright.
 */
export const HISTORY_LIMIT = 60;

function isProposal(value: unknown): value is ToolCallProposal {
  if (typeof value !== 'object' || value === null) return false;
  const proposal = value as Partial<ToolCallProposal>;
  return typeof proposal.id === 'string' && typeof proposal.name === 'string' && typeof proposal.args === 'object';
}

function isMessage(value: unknown): value is ChatMessage {
  if (typeof value !== 'object' || value === null) return false;
  const message = value as Partial<ChatMessage>;
  if (message.role !== 'user' && message.role !== 'assistant' && message.role !== 'tool') return false;
  if (typeof message.content !== 'string') return false;
  if (message.proposals !== undefined && !Array.isArray(message.proposals)) return false;
  if (message.proposals?.some((entry) => !isProposal(entry)) === true) return false;
  return true;
}

/**
 * Keeps the most recent messages without orphaning a tool reply.
 *
 * Cutting from the front can leave a `tool` message first, whose assistant
 * parent is now gone. The window is walked forward past any such message before
 * it is returned — dropping a reply whose question is missing loses nothing the
 * model could have used anyway.
 */
export function trimHistory(messages: readonly ChatMessage[], limit: number = HISTORY_LIMIT): readonly ChatMessage[] {
  const window = messages.length <= limit ? messages : messages.slice(messages.length - limit);
  let start = 0;
  while (start < window.length && window[start]?.role === 'tool') start += 1;
  return start === 0 ? window : window.slice(start);
}

/** Reads a stored transcript back, keeping only what still has the right shape. */
export function parseHistory(raw: unknown): readonly ChatMessage[] {
  if (!Array.isArray(raw)) return [];
  // A message that failed to parse is a hole in the middle of the conversation,
  // and a hole where an assistant's tool call used to be orphans the reply after
  // it — so the same pairing rule is applied to whatever survived.
  return trimHistory(raw.filter(isMessage));
}
