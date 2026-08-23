import { describe, expect, it } from 'vitest';

import { AGENT_CHAT_READ_ONLY_TOOL_NAMES, agentChatMutatingToolNames } from '../src/main/agentChatTools';
import { getOpenVideoMcpDefinition } from '../src/main/openVideoMcpServer';

/**
 * What the Edit Agent may do without asking.
 *
 * The README promises: "Anything that writes to your project or starts a job
 * pauses for approval first." Four tools broke that promise —
 * `splitTimelineClip`, `addTimelineTitle`, `removeTimelineTitle` and
 * `setTimelineTransition` all wrote to a saved project and ran immediately,
 * because the graph asks the question in a way that fails open:
 *
 *     mutatingToolNames.has(call.name) ? toolDecisions[call.id] : 'approve'
 *
 * A name missing from a mutating list is auto-approved, and the list was written
 * before those tools existed. So the question is asked the other way round now,
 * and this walks the server's real tools rather than a copy of any list.
 */
const toolNames = (getOpenVideoMcpDefinition()?.tools ?? []).map((tool) => tool.name);

describe('the approval boundary', () => {
  it('covers every tool the server actually registers', () => {
    expect(toolNames.length).toBeGreaterThan(0);
    const mutating = agentChatMutatingToolNames(toolNames.map((name) => ({ name })));
    for (const name of toolNames) {
      // Either it is declared read-only, or it needs approval. There is no
      // third answer, and no way to add a tool that quietly has neither.
      expect(mutating.has(name) || AGENT_CHAT_READ_ONLY_TOOL_NAMES.has(name), `${name} is neither`).toBe(true);
      expect(mutating.has(name) && AGENT_CHAT_READ_ONLY_TOOL_NAMES.has(name), `${name} is both`).toBe(false);
    }
  });

  it('asks before the writes that used to happen silently', () => {
    const mutating = agentChatMutatingToolNames(toolNames.map((name) => ({ name })));
    for (const name of ['splitTimelineClip', 'addTimelineTitle', 'removeTimelineTitle', 'setTimelineTransition']) {
      expect(toolNames, `${name} should be a registered tool`).toContain(name);
      expect(mutating.has(name), `${name} writes to a saved project and must ask`).toBe(true);
    }
  });

  it('keeps reading the project free of prompts', () => {
    // The other failure mode: an agent that asks permission to look at the
    // timeline is an agent nobody lets finish a sentence.
    const mutating = agentChatMutatingToolNames(toolNames.map((name) => ({ name })));
    for (const name of ['getProjectTimeline', 'getJobStatus', 'estimateGenerationCost']) {
      expect(mutating.has(name), `${name} only reads`).toBe(false);
    }
  });

  it('treats a tool nobody classified as needing approval', () => {
    // The point of inverting the list: the cost of forgetting is one
    // unnecessary prompt, not a silent write to someone's project.
    expect(agentChatMutatingToolNames([{ name: 'someToolAddedTomorrow' }]).has('someToolAddedTomorrow')).toBe(true);
  });
});

describe('the capability descriptor', () => {
  it('advertises what the server has, rather than a list typed out beside it', () => {
    // It went stale the moment the agent gained the edits it could not reach:
    // fifteen names advertised against nineteen registered. A descriptor that
    // disagrees with the server is worse than none — it is what a client
    // believes.
    const source = getOpenVideoMcpDefinition();
    expect(source?.tools.map((tool) => tool.name)).toContain('splitTimelineClip');
  });
});
