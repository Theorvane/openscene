import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { tool } from '@langchain/core/tools';
import { AIMessage } from '@langchain/core/messages';
import { buildAgentChatGraph, type AgentChatModelFactory } from '../src/main/agentChatGraph';
import { AgentChatSessionManager } from '../src/main/agentChatSession';

const READ_ONLY_TOOL_NAME = 'getJobStatus';
const MUTATING_TOOL_NAME = 'exportProjectVideo';

const fakeTools = [
  tool(async ({ jobId }: { jobId: string }) => JSON.stringify({ success: true, jobId, status: 'completed' }), {
    name: READ_ONLY_TOOL_NAME,
    description: 'Check job status',
    schema: z.object({ jobId: z.string() })
  }),
  tool(async ({ projectId }: { projectId: string }) => JSON.stringify({ success: true, projectId, exportJobId: 'export-1' }), {
    name: MUTATING_TOOL_NAME,
    description: 'Export the project',
    schema: z.object({ projectId: z.string() })
  })
];

const MUTATING_TOOL_NAMES = new Set([MUTATING_TOOL_NAME]);

function scriptedModel(responses: readonly AIMessage[]): AgentChatModelFactory {
  let call = 0;
  return () => ({
    invoke: async () => {
      const response = responses[Math.min(call, responses.length - 1)]!;
      call += 1;
      return response;
    }
  });
}

function buildSession(responses: readonly AIMessage[]): AgentChatSessionManager {
  const bundle = buildAgentChatGraph({
    tools: fakeTools,
    mutatingToolNames: MUTATING_TOOL_NAMES,
    createModel: scriptedModel(responses)
  });
  return new AgentChatSessionManager(bundle);
}

describe('agent chat graph', () => {
  it('answers directly when the model makes no tool calls', async () => {
    const session = buildSession([new AIMessage('Hello! How can I help?')]);

    const result = await session.sendMessage({ conversationId: 'c1', text: 'hi', modelId: 'qwen2.5-coder' });

    expect(result.status).toBe('idle');
    expect(result.pendingApproval).toBeNull();
    expect(result.messages.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(result.messages[1]!.text).toBe('Hello! How can I help?');
  });

  it('executes a read-only tool call without requiring approval', async () => {
    const session = buildSession([
      new AIMessage({
        content: '',
        tool_calls: [{ id: 'call-1', name: READ_ONLY_TOOL_NAME, args: { jobId: 'job-1' } }]
      }),
      new AIMessage('Job job-1 is completed.')
    ]);

    const result = await session.sendMessage({ conversationId: 'c2', text: 'check job-1', modelId: 'qwen2.5-coder' });

    expect(result.status).toBe('idle');
    expect(result.pendingApproval).toBeNull();
    const toolMessage = result.messages.find((m) => m.role === 'tool');
    expect(toolMessage?.toolName).toBe(READ_ONLY_TOOL_NAME);
    expect(toolMessage?.text).toContain('completed');
    expect(result.messages.at(-1)?.text).toBe('Job job-1 is completed.');
  });

  it('pauses a mutating tool call for approval, then executes it once approved', async () => {
    const session = buildSession([
      new AIMessage({
        content: '',
        tool_calls: [{ id: 'call-2', name: MUTATING_TOOL_NAME, args: { projectId: 'proj-1' } }]
      }),
      new AIMessage('Export started.')
    ]);

    const paused = await session.sendMessage({ conversationId: 'c3', text: 'export it', modelId: 'qwen2.5-coder' });
    expect(paused.status).toBe('awaiting-approval');
    expect(paused.pendingApproval).toEqual({ toolCallId: 'call-2', toolName: MUTATING_TOOL_NAME, args: { projectId: 'proj-1' } });
    // The tool must not have run yet.
    expect(paused.messages.some((m) => m.role === 'tool')).toBe(false);

    const resumed = await session.respondToApproval({ conversationId: 'c3', toolCallId: 'call-2', decision: 'approve' });
    expect(resumed.status).toBe('idle');
    expect(resumed.pendingApproval).toBeNull();
    const toolMessage = resumed.messages.find((m) => m.role === 'tool');
    expect(toolMessage?.toolName).toBe(MUTATING_TOOL_NAME);
    expect(toolMessage?.text).toContain('export-1');
    expect(resumed.messages.at(-1)?.text).toBe('Export started.');
  });

  it('ignores an approval response whose toolCallId does not match the pending proposal', async () => {
    const session = buildSession([
      new AIMessage({
        content: '',
        tool_calls: [{ id: 'call-stale', name: MUTATING_TOOL_NAME, args: { projectId: 'proj-1' } }]
      }),
      new AIMessage('Export started.')
    ]);

    const paused = await session.sendMessage({ conversationId: 'c6', text: 'export it', modelId: 'qwen2.5-coder' });
    expect(paused.pendingApproval?.toolCallId).toBe('call-stale');

    // Simulates a stale UI response — e.g. from a previous, already-resolved or unrelated proposal.
    const mismatched = await session.respondToApproval({ conversationId: 'c6', toolCallId: 'call-from-a-different-turn', decision: 'approve' });

    expect(mismatched.error).toBeDefined();
    // The action must still be pending, and the tool must not have run.
    expect(mismatched.status).toBe('awaiting-approval');
    expect(mismatched.pendingApproval).toEqual({ toolCallId: 'call-stale', toolName: MUTATING_TOOL_NAME, args: { projectId: 'proj-1' } });
    expect(mismatched.messages.some((m) => m.role === 'tool')).toBe(false);

    // The real pending proposal can still be resolved afterward.
    const resumed = await session.respondToApproval({ conversationId: 'c6', toolCallId: 'call-stale', decision: 'approve' });
    expect(resumed.status).toBe('idle');
    expect(resumed.messages.some((m) => m.role === 'tool')).toBe(true);
  });

  it('records a denial instead of executing the mutating tool', async () => {
    const session = buildSession([
      new AIMessage({
        content: '',
        tool_calls: [{ id: 'call-3', name: MUTATING_TOOL_NAME, args: { projectId: 'proj-1' } }]
      }),
      new AIMessage('Okay, I will not export.')
    ]);

    await session.sendMessage({ conversationId: 'c4', text: 'export it', modelId: 'qwen2.5-coder' });
    const resumed = await session.respondToApproval({ conversationId: 'c4', toolCallId: 'call-3', decision: 'deny' });

    expect(resumed.status).toBe('idle');
    const toolMessage = resumed.messages.find((m) => m.role === 'tool');
    expect(toolMessage?.text).toContain('denied');
    expect(resumed.messages.at(-1)?.text).toBe('Okay, I will not export.');
  });

  it('reset clears prior conversation history for that thread', async () => {
    const session = buildSession([new AIMessage('First answer.'), new AIMessage('Second answer.')]);

    await session.sendMessage({ conversationId: 'c5', text: 'first', modelId: 'qwen2.5-coder' });
    const resetResult = await session.resetConversation({ conversationId: 'c5' });
    expect(resetResult.messages).toEqual([]);

    const afterReset = await session.sendMessage({ conversationId: 'c5', text: 'second', modelId: 'qwen2.5-coder' });
    // Only the new turn's messages should be present, not the pre-reset history.
    expect(afterReset.messages.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(afterReset.messages[0]!.text).toBe('second');
  });

  it('injects the active project scope into the system prompt when the send carries one', async () => {
    const seenSystemPrompts: string[] = [];
    const capturingModel: AgentChatModelFactory = () => ({
      invoke: async (messages) => {
        const first = messages[0]!;
        seenSystemPrompts.push(typeof first.content === 'string' ? first.content : '');
        return new AIMessage('Working on your project.');
      }
    });
    const bundle = buildAgentChatGraph({
      tools: fakeTools,
      mutatingToolNames: MUTATING_TOOL_NAMES,
      createModel: capturingModel
    });
    const session = new AgentChatSessionManager(bundle);

    await session.sendMessage({
      conversationId: 'c6',
      text: 'trim the intro',
      modelId: 'qwen2.5-coder',
      activeProject: { projectId: 'proj-1', name: 'Demo Reel', assetCount: 4, trackCount: 2 }
    });

    expect(seenSystemPrompts[0]).toContain('projectId=proj-1');
    expect(seenSystemPrompts[0]).toContain('name=Demo Reel');
    expect(seenSystemPrompts[0]).toContain('4 imported assets');
    expect(seenSystemPrompts[0]).toContain('2 timeline tracks');
    expect(seenSystemPrompts[0]).toContain('Operate on this project by default');
  });

  it('keeps the base system prompt when no project scope is provided', async () => {
    const seenSystemPrompts: string[] = [];
    const capturingModel: AgentChatModelFactory = () => ({
      invoke: async (messages) => {
        const first = messages[0]!;
        seenSystemPrompts.push(typeof first.content === 'string' ? first.content : '');
        return new AIMessage('Hello.');
      }
    });
    const bundle = buildAgentChatGraph({
      tools: fakeTools,
      mutatingToolNames: MUTATING_TOOL_NAMES,
      createModel: capturingModel
    });
    const session = new AgentChatSessionManager(bundle);

    await session.sendMessage({ conversationId: 'c7', text: 'hi', modelId: 'qwen2.5-coder' });

    expect(seenSystemPrompts[0]).not.toContain('active project scope');
  });

  it('turns watchProjectVideo frame output into a summary tool message plus a multimodal image message, never base64 text', async () => {
    const jpegBase64 = 'ZmFrZS1qcGVnLWJ5dGVz';
    const watchTool = tool(
      async () =>
        JSON.stringify({
          success: true,
          frameCount: 2,
          summary: 'Sampled 2 frames from "take.mp4" at 0:02, 0:07. The frames are attached to the conversation as images in chronological order.',
          frames: [
            { timeMs: 2_000, timestamp: '0:02', jpegBase64 },
            { timeMs: 7_000, timestamp: '0:07', jpegBase64 }
          ]
        }),
      {
        name: 'watchProjectVideo',
        description: 'Watch a project video asset',
        schema: z.object({ projectId: z.string(), assetId: z.string() })
      }
    );

    const seenMessageContents: unknown[][] = [];
    const bundle = buildAgentChatGraph({
      tools: [watchTool],
      mutatingToolNames: new Set(),
      createModel: (() => {
        let call = 0;
        return () => ({
          invoke: async (messages) => {
            seenMessageContents.push(messages.map((message) => message.content as unknown));
            call += 1;
            return call === 1
              ? new AIMessage({ content: '', tool_calls: [{ id: 'call-w', name: 'watchProjectVideo', args: { projectId: 'p', assetId: 'a' } }] })
              : new AIMessage('The clip opens on a city skyline.');
          }
        });
      })() as AgentChatModelFactory
    });
    const session = new AgentChatSessionManager(bundle);

    const result = await session.sendMessage({ conversationId: 'cw', text: 'what is in take.mp4?', modelId: 'qwen2.5-coder' });

    // The transcript shown to the user never contains raw base64 frames.
    expect(JSON.stringify(result.messages)).not.toContain(jpegBase64);
    const toolMessage = result.messages.find((m) => m.role === 'tool');
    expect(toolMessage?.text).toContain('Sampled 2 frames');
    expect(result.messages.at(-1)?.text).toBe('The clip opens on a city skyline.');

    // The model's second invocation sees the frames as image_url content blocks.
    const secondInvocation = seenMessageContents[1]!;
    const multimodal = secondInvocation.find(
      (content) => Array.isArray(content) && content.some((part) => (part as { type?: string }).type === 'image_url')
    ) as readonly { type: string; image_url?: { url: string } }[] | undefined;
    expect(multimodal).toBeDefined();
    const imageParts = multimodal!.filter((part) => part.type === 'image_url');
    expect(imageParts).toHaveLength(2);
    expect(imageParts[0]!.image_url?.url).toBe(`data:image/jpeg;base64,${jpegBase64}`);
  });
});
