import { describe, expect, it } from 'vitest';

import { dropUnansweredCalls, forStorage, HISTORY_LIMIT, parseHistory, trimHistory } from '../mobile/src/lib/chatMemory';
import type { ChatMessage } from '../mobile/src/lib/chatMemory';

/**
 * A transcript is not a flat list of turns. An assistant message that proposed a
 * tool call and the `tool` message answering it are a pair, and every provider
 * rejects the second without the first — so trimming by slicing the front is how
 * a saved conversation becomes one that will not send.
 */

const user = (content: string): ChatMessage => ({ role: 'user', content });
const assistant = (content: string): ChatMessage => ({ role: 'assistant', content });
const proposing = (id: string): ChatMessage => ({
  role: 'assistant',
  content: '',
  proposals: [{ id, name: 'describe_timeline', args: {} }]
});
const answering = (id: string): ChatMessage => ({
  role: 'tool',
  content: 'ok',
  toolCallId: id,
  toolName: 'describe_timeline'
});

describe('chat memory', () => {
  it('keeps a short conversation exactly as it is', () => {
    const history = [user('hi'), assistant('hello')];
    expect(trimHistory(history)).toEqual(history);
  });

  it('keeps only the most recent messages once past the limit', () => {
    const history = Array.from({ length: HISTORY_LIMIT + 10 }, (_, index) => user(`m${index}`));
    const trimmed = trimHistory(history);

    expect(trimmed).toHaveLength(HISTORY_LIMIT);
    expect(trimmed[0]).toEqual(user('m10'));
    expect(trimmed[trimmed.length - 1]).toEqual(user(`m${HISTORY_LIMIT + 9}`));
  });

  it('never begins a window with a tool reply whose proposal was cut', () => {
    // The cut lands between the proposal and its answer, which is exactly the
    // case that makes the next request fail.
    const history = [proposing('call-1'), answering('call-1'), user('and now?')];
    const trimmed = trimHistory(history, 2);

    expect(trimmed.map((message) => message.role)).toEqual(['user']);
  });

  it('drops every orphaned reply, not just the first', () => {
    const history = [proposing('a'), answering('a'), answering('b'), assistant('done')];
    const trimmed = trimHistory(history, 3);

    expect(trimmed.map((message) => message.role)).toEqual(['assistant']);
    expect(trimmed[0]?.content).toBe('done');
  });

  it('keeps a pair together when the window has room for both', () => {
    const history = [user('what is on it?'), proposing('call-1'), answering('call-1'), assistant('11.9s')];
    expect(trimHistory(history, 3).map((message) => message.role)).toEqual(['assistant', 'tool', 'assistant']);
  });

  it('reads nothing back from a file that is not a transcript', () => {
    expect(parseHistory(null)).toEqual([]);
    expect(parseHistory({ role: 'user' })).toEqual([]);
    expect(parseHistory('[]')).toEqual([]);
  });

  it('drops entries that lost their shape and re-checks the pairing', () => {
    // A hole where an assistant's tool call used to be orphans the reply after
    // it, so filtering alone is not enough.
    const stored = [{ role: 'nonsense' }, answering('call-1'), user('still here')];
    expect(parseHistory(stored)).toEqual([user('still here')]);
  });

  it('cuts the conversation off before a tool call nobody answered', () => {
    // Quitting while the approval card is up leaves the file ending in
    // `tool_calls` with no reply. Every provider rejects that, so the saved
    // conversation could never send again.
    const history = [user('make me an image'), proposing('call-1')];
    expect(dropUnansweredCalls(history)).toEqual([user('make me an image')]);
  });

  it('keeps a call that was answered', () => {
    const history = [user('what is on it?'), proposing('call-1'), answering('call-1'), assistant('11.9s')];
    expect(dropUnansweredCalls(history)).toEqual(history);
  });

  it('drops everything after the first unanswered call, not just the call', () => {
    // Anything the model said past a call it never got a result for was written
    // against a history the provider will not accept.
    const history = [proposing('a'), answering('a'), proposing('b'), assistant('stranded')];
    expect(dropUnansweredCalls(history)).toEqual([proposing('a'), answering('a')]);
  });

  it('repairs a wedged transcript on the way back in', () => {
    expect(parseHistory([user('make me an image'), proposing('call-1')])).toEqual([user('make me an image')]);
  });

  it('rejects a proposal whose args are null', () => {
    // `typeof null === 'object'`, so the obvious check passes it, and it reaches
    // the wire as the string "null" for the provider to reject.
    const stored = [
      { role: 'assistant', content: '', proposals: [{ id: 'a', name: 'generate_image', args: null }] },
      user('after')
    ];
    expect(parseHistory(stored)).toEqual([user('after')]);
  });

  it('drops image bytes on the way to storage but records that there were some', () => {
    // A generated image is a megabyte or two of base64, and the transcript is
    // re-read and re-parsed on the render that opens the tab.
    const withImage: ChatMessage = {
      role: 'tool',
      content: 'Generated an image.',
      toolCallId: 'call-1',
      toolName: 'generate_image',
      image: 'data:image/png;base64,AAAA'
    };
    const [stored] = forStorage([user('draw a leaf'), withImage]).slice(1);

    expect(stored?.image).toBeUndefined();
    expect(stored?.imageDropped).toBe(true);
    expect(stored?.content).toBe('Generated an image.');
  });

  it('leaves messages without an image untouched on the way to storage', () => {
    const history = [user('hi'), assistant('hello')];
    expect(forStorage(history)).toEqual(history);
  });

  it('keeps a well-formed stored transcript', () => {
    const stored = [user('hi'), assistant('hello')];
    expect(parseHistory(JSON.parse(JSON.stringify(stored)))).toEqual(stored);
  });
});
