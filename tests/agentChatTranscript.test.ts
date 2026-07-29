import { describe, expect, it } from 'vitest';

import {
  describeAgentChatToolResult,
  mergePendingUserMessage,
  parseAgentChatInline,
  parseAgentChatMarkdown
} from '../src/renderer/src/agentChatTranscript';

describe('Edit Agent transcript formatting', () => {
  it('keeps the just-sent turn on screen when the failed turn was never recorded', () => {
    const pending = { id: 'pending-1', role: 'user', text: 'add the clip' } as const;
    const recorded = [{ id: 'm0', role: 'user', text: 'hi' } as const];

    expect(mergePendingUserMessage(recorded, pending)).toEqual([...recorded, pending]);
    // Already recorded by the graph: no duplicate row.
    expect(mergePendingUserMessage([...recorded, { id: 'm1', role: 'user', text: 'add the clip' }], pending)).toHaveLength(2);
  });

  it('renders the agent markdown the model actually writes instead of literal asterisks', () => {
    const blocks = parseAgentChatMarkdown(
      [
        '현재 프로젝트에는 영상 1개가 있어:',
        '',
        '- **02-recommendations.mp4** — 약 1분 8초',
        '- 타임라인은 비어 있어.',
        '',
        '1. 비디오 트랙 1개',
        '2. 오디오 트랙 1개'
      ].join('\n')
    );

    expect(blocks.map((block) => block.kind)).toEqual(['paragraph', 'bullets', 'ordered']);
    const bullets = blocks[1];
    if (bullets?.kind !== 'bullets') throw new Error('Expected a bullet block.');
    expect(bullets.items).toHaveLength(2);
    expect(bullets.items[0]?.[0]).toEqual({ kind: 'strong', value: '02-recommendations.mp4' });
    const ordered = blocks[2];
    if (ordered?.kind !== 'ordered') throw new Error('Expected an ordered block.');
    expect(ordered.items).toHaveLength(2);
  });

  it('keeps fenced code verbatim and never treats its content as markdown', () => {
    const blocks = parseAgentChatMarkdown(['설명', '', '```bash', 'npm run dev -- --flag **x**', '```'].join('\n'));

    expect(blocks[1]).toEqual({ kind: 'code', language: 'bash', value: 'npm run dev -- --flag **x**' });
  });

  it('keeps the agent line breaks inside a paragraph', () => {
    const blocks = parseAgentChatMarkdown('first line\nsecond line');

    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toEqual({ kind: 'paragraph', spans: [{ kind: 'text', value: 'first line\nsecond line' }] });
  });

  it('splits inline bold and code out of surrounding text', () => {
    expect(parseAgentChatInline('run `npm test` after **the fix** now')).toEqual([
      { kind: 'text', value: 'run ' },
      { kind: 'code', value: 'npm test' },
      { kind: 'text', value: ' after ' },
      { kind: 'strong', value: 'the fix' },
      { kind: 'text', value: ' now' }
    ]);
    // An unpaired marker stays literal rather than swallowing the rest.
    expect(parseAgentChatInline('2 * 3 * 4')).toEqual([{ kind: 'text', value: '2 * 3 * 4' }]);
  });

  it('collapses a successful tool payload to its field names with the payload kept for the detail view', () => {
    const result = describeAgentChatToolResult('{"success":true,"project":{"id":"p1"},"timeline":{"tracks":[]}}');

    expect(result.status).toBe('ok');
    expect(result.summary).toBe('project, timeline');
    // Pretty-printed, so the expanded view is readable.
    expect(result.detail).toContain('\n  "project": {');
  });

  it('surfaces the tool error as the collapsed summary', () => {
    const result = describeAgentChatToolResult('{"success":false,"error":"The project folder is not writable."}');

    expect(result.status).toBe('failed');
    expect(result.summary).toBe('The project folder is not writable.');
  });

  it('falls back to the first line for tool output that is not JSON', () => {
    const result = describeAgentChatToolResult('Exported 3 clips\nto /tmp/out.mp4');

    expect(result.status).toBe('unknown');
    expect(result.summary).toBe('Exported 3 clips');
    expect(result.detail).toBe('Exported 3 clips\nto /tmp/out.mp4');
  });
});
