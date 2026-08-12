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
  /**
   * A generated image, as a data URI, carried by the tool reply that produced it.
   *
   * On the message rather than in a list beside the thread, so it appears where
   * it was made instead of after everything else — and so restoring a
   * conversation cannot bring the words back without the picture.
   *
   * In memory only; see `forStorage`.
   */
  readonly image?: string;
  /** Set when the image was dropped on the way to disk, so the bubble can say so. */
  readonly imageDropped?: boolean;
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
  // `typeof null === 'object'`, and a null `args` serialises onto the wire as
  // the string "null", which the provider rejects on a conversation that looks
  // perfectly fine on screen.
  return (
    typeof proposal.id === 'string' &&
    typeof proposal.name === 'string' &&
    typeof proposal.args === 'object' &&
    proposal.args !== null
  );
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
 * The transcript as it should be written down.
 *
 * A generated image is a megabyte or two of base64. Kept in the file it would be
 * re-read and re-parsed on the render that opens the AI tab, several of them at
 * once, which is a stall the conversation does not justify. The bytes are
 * dropped and the fact that there was one is not, so the restored bubble can say
 * the picture is gone rather than silently omitting it.
 */
export function forStorage(messages: readonly ChatMessage[]): readonly ChatMessage[] {
  return trimHistory(messages).map((message) => {
    if (message.image === undefined) return message;
    const { image: _image, ...rest } = message;
    return { ...rest, imageDropped: true };
  });
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

/**
 * Cuts a conversation off before the first tool call nobody answered.
 *
 * A proposal is only answered once the user approves or declines it, and the
 * assistant message carrying it is written down the moment it arrives. Quit
 * while the approval card is up — or lose the process to the OS — and the file
 * ends with `tool_calls` and no reply. Every provider rejects that outright
 * ("An assistant message with 'tool_calls' must be followed by tool messages
 * responding to each 'tool_call_id'"), so the conversation is not merely stale:
 * it can never send again, and no amount of typing will clear it.
 *
 * Losing this transcript used to hide the problem, because the screen threw the
 * whole thing away when it unmounted. Keeping it is what makes the wedge
 * permanent, so keeping it has to come with the repair.
 */
export function dropUnansweredCalls(messages: readonly ChatMessage[]): readonly ChatMessage[] {
  const answered = new Set(
    messages.filter((message) => message.role === 'tool').map((message) => message.toolCallId)
  );
  const wedged = messages.findIndex(
    (message) => message.proposals?.some((proposal) => !answered.has(proposal.id)) === true
  );
  return wedged === -1 ? messages : messages.slice(0, wedged);
}

/** Reads a stored transcript back, keeping only what still has the right shape. */
export function parseHistory(raw: unknown): readonly ChatMessage[] {
  if (!Array.isArray(raw)) return [];
  // A message that failed to parse is a hole in the middle of the conversation,
  // and a hole where an assistant's tool call used to be orphans the reply after
  // it — so the same pairing rule is applied to whatever survived.
  return trimHistory(dropUnansweredCalls(raw.filter(isMessage)));
}
