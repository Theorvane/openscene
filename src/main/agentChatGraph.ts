import {
  HumanMessage,
  isAIMessage,
  isHumanMessage,
  isSystemMessage,
  isToolMessage,
  SystemMessage,
  ToolMessage,
  type AIMessage,
  type BaseMessage
} from '@langchain/core/messages';
import type { DynamicStructuredTool } from '@langchain/core/tools';
import { Annotation, END, MemorySaver, START, StateGraph, interrupt } from '@langchain/langgraph';
import type { AgentToolCallProposal, AgentToolApprovalDecision } from '../shared/agentChat';
import { parseEditAgentProjectContext, type EditAgentContextAsset, type EditAgentProjectContext } from '../shared/editAgentContext';
import type { OpenAiAuthMode, ReasoningEffort } from '../shared/openAiAuth';

const AGENT_CHAT_SYSTEM_PROMPT =
  'You are the OpenVideo in-app agent. You drive the whole editor through the provided tools: read a ' +
  'project timeline, add, trim, and remove clips, adjust clip effects, and start an FFmpeg export. ' +
  'You also own generation end to end. To add generated media: call createVideoJob or createSpeechJob, ' +
  'poll getJobStatus until it reports completed, call importGeneratedResult to bring the result into the ' +
  'project as an asset, then place that assetId with addClipToTimeline. Do not ask the user to do those ' +
  'steps by hand. Generation runs against the cloud provider connected in Settings and fails with an ' +
  'explicit error when none is connected — report that error rather than claiming a provider works. ' +
  'You can also watch a project video with the watchProjectVideo tool: sampled frames arrive attached to ' +
  'the conversation as images with timestamps — use them to describe or reason about the footage ' +
  '(a vision-capable model is required to actually see them). ' +
  'Keep replies short, and say what you are about to do before calling a tool.';

// isAIMessage narrows on `_getType() === 'ai'`, which is also true for the AIMessageChunk that
// chat model .invoke() calls actually return, so it doubles as our AI-message-of-either-kind check.
function isAiLike(message: BaseMessage): message is AIMessage {
  return isAIMessage(message);
}

function getEditAssetContext(rawContext: string | undefined): readonly EditAgentContextAsset[] {
  if (!rawContext) return [];
  try {
    const parsed: unknown = JSON.parse(rawContext);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is EditAgentContextAsset => {
      if (typeof entry !== 'object' || entry === null) return false;
      const asset = entry as Partial<EditAgentContextAsset>;
      return typeof asset.projectId === 'string' && typeof asset.assetId === 'string' && typeof asset.label === 'string' && (asset.mediaKind === 'audio' || asset.mediaKind === 'video');
    }).slice(0, 20);
  } catch {
    return [];
  }
}

function getEditProjectContext(rawContext: string | undefined): EditAgentProjectContext | null {
  if (!rawContext) return null;
  try {
    return parseEditAgentProjectContext(JSON.parse(rawContext));
  } catch {
    return null;
  }
}

function buildAgentSystemPrompt(
  contextAssets: readonly EditAgentContextAsset[],
  projectContext: EditAgentProjectContext | null
): string {
  let prompt = AGENT_CHAT_SYSTEM_PROMPT;

  if (projectContext !== null) {
    prompt += ` The active project scope for this conversation is projectId=${projectContext.projectId}, name=${projectContext.name}, with ${projectContext.assetCount} imported assets and ${projectContext.trackCount} timeline tracks. Operate on this project by default and use its projectId for every project-scoped tool call; never infer paths or credentials.`;
  }

  if (contextAssets.length > 0) {
    const assetList = contextAssets.map((asset) => `${asset.mediaKind} assetId=${asset.assetId}, projectId=${asset.projectId}, label=${asset.label}`).join('; ');
    prompt += ` The user explicitly attached these project assets for this turn: ${assetList}. Use only these asset IDs; never infer paths or credentials.`;
  }

  return prompt;
}

type WatchFramesPayload = {
  readonly summary: string;
  readonly frames: readonly { readonly timeMs: number; readonly timestamp?: string; readonly jpegBase64: string }[];
};

/**
 * Detect a frame-carrying tool result (watchProjectVideo). Frames must never
 * enter the transcript as base64 text — the tool message keeps only the
 * summary, and the frames become a multimodal user message so vision-capable
 * models can see them.
 */
function parseWatchFramesPayload(output: unknown): WatchFramesPayload | null {
  let value: unknown = output;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (typeof value !== 'object' || value === null) return null;
  const candidate = value as { success?: unknown; summary?: unknown; frames?: unknown };
  if (candidate.success !== true || !Array.isArray(candidate.frames)) return null;
  const frames = candidate.frames.filter(
    (frame): frame is { timeMs: number; timestamp?: string; jpegBase64: string } =>
      typeof frame === 'object' && frame !== null &&
      typeof (frame as { jpegBase64?: unknown }).jpegBase64 === 'string' &&
      typeof (frame as { timeMs?: unknown }).timeMs === 'number'
  );
  if (frames.length === 0) return null;
  return {
    summary: typeof candidate.summary === 'string' ? candidate.summary : `Extracted ${frames.length} video frames.`,
    frames
  };
}

function buildWatchFramesMessage(toolName: string, payload: WatchFramesPayload): HumanMessage {
  const timestamps = payload.frames.map((frame) => frame.timestamp ?? `${Math.round(frame.timeMs / 1000)}s`).join(', ');
  return new HumanMessage({
    content: [
      {
        type: 'text',
        text: `[OpenVideo] ${payload.frames.length} video frames from ${toolName}, chronological, at ${timestamps}.`
      },
      ...payload.frames.map((frame) => ({
        type: 'image_url' as const,
        image_url: { url: `data:image/jpeg;base64,${frame.jpegBase64}` }
      }))
    ]
  });
}

export interface AgentChatModelHandle {
  invoke(messages: BaseMessage[]): Promise<AIMessage>;
}

export type AgentChatModelFactory = (config: {
  readonly modelId: string;
  readonly openAiAuthMode: OpenAiAuthMode | undefined;
  readonly reasoningEffort: ReasoningEffort | undefined;
  readonly ollamaBaseUrl: string | undefined;
}) => AgentChatModelHandle;

const AgentChatState = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: (current, update) => current.concat(update),
    default: () => []
  }),
  /** Tools the user chose to always allow; never asked about again. */
  alwaysAllowedTools: Annotation<string[]>({
    reducer: (current, update) => [...new Set([...current, ...update])],
    default: () => []
  }),
  /** Reason the user gave when denying a call, passed back as a correction. */
  toolFeedback: Annotation<Record<string, string>>({
    reducer: (current, update) => ({ ...current, ...update }),
    default: () => ({})
  }),
  toolDecisions: Annotation<Record<string, AgentToolApprovalDecision>>({
    reducer: (current, update) => ({ ...current, ...update }),
    default: () => ({})
  })
});

export interface BuildAgentChatGraphOptions {
  readonly tools: readonly DynamicStructuredTool[];
  readonly mutatingToolNames: ReadonlySet<string>;
  readonly createModel: AgentChatModelFactory;
}

export function buildAgentChatGraph(options: BuildAgentChatGraphOptions) {
  const toolsByName = new Map(options.tools.map((tool) => [tool.name, tool]));

  const builder = new StateGraph(AgentChatState)
    .addNode('agent', async (state, config) => {
      const configurable = (config?.configurable ?? {}) as { modelId?: string; openAiAuthMode?: OpenAiAuthMode; reasoningEffort?: ReasoningEffort; ollamaBaseUrl?: string; editAssetContext?: string; editProjectContext?: string };
      if (!configurable.modelId) {
        throw new Error('agentChatGraph: a modelId must be provided via config.configurable.');
      }

      const model = options.createModel({
        modelId: configurable.modelId,
        openAiAuthMode: configurable.openAiAuthMode,
        reasoningEffort: configurable.reasoningEffort,
        ollamaBaseUrl: configurable.ollamaBaseUrl
      });
      const hasSystemPrompt = state.messages.length > 0 && isSystemMessage(state.messages[0]!);
      const messages = hasSystemPrompt
        ? state.messages
        : [new SystemMessage(buildAgentSystemPrompt(getEditAssetContext(configurable.editAssetContext), getEditProjectContext(configurable.editProjectContext))), ...state.messages];

      const response = await model.invoke(messages);
      return { messages: [response] };
    })
    .addNode('checkApproval', async (state) => {
      const last = state.messages[state.messages.length - 1];
      if (!last || !isAiLike(last) || !last.tool_calls || last.tool_calls.length === 0) {
        return {};
      }

      const decisions: Record<string, AgentToolApprovalDecision> = {};
      for (const call of last.tool_calls) {
        if (!call.id || !options.mutatingToolNames.has(call.name) || state.toolDecisions[call.id]) {
          continue;
        }
        if (state.alwaysAllowedTools.includes(call.name)) {
          decisions[call.id] = 'approve';
          continue;
        }
        const proposal: AgentToolCallProposal = {
          toolCallId: call.id,
          toolName: call.name,
          args: (call.args ?? {}) as Record<string, unknown>
        };
        decisions[call.id] = interrupt<AgentToolCallProposal, AgentToolApprovalDecision>(proposal);
      }
      const alwaysAllowedTools = Object.entries(decisions)
        .filter(([, decision]) => decision === 'always')
        .map(([callId]) => last.tool_calls?.find((call) => call.id === callId)?.name)
        .filter((name): name is string => name !== undefined);
      return { toolDecisions: decisions, alwaysAllowedTools };
    })
    .addNode('executeTools', async (state) => {
      const last = state.messages[state.messages.length - 1];
      if (!last || !isAiLike(last) || !last.tool_calls) {
        return { messages: [] };
      }

      const results: BaseMessage[] = [];
      for (const call of last.tool_calls) {
        if (!call.id) continue;

        const decision = options.mutatingToolNames.has(call.name) ? state.toolDecisions[call.id] : 'approve';
        if (decision !== 'approve' && decision !== 'always') {
          // A denial with feedback reads as a correction, so the model can act
          // on the reason instead of only learning that it was refused.
          const feedback = state.toolFeedback[call.id];
          const content = feedback === undefined || feedback.trim().length === 0
            ? `User denied the "${call.name}" action.`
            : `User denied the "${call.name}" action: ${feedback.trim()}`;
          results.push(new ToolMessage({ content, tool_call_id: call.id, name: call.name }));
          continue;
        }

        const tool = toolsByName.get(call.name);
        if (!tool) {
          results.push(new ToolMessage({ content: `Unknown tool "${call.name}".`, tool_call_id: call.id, name: call.name }));
          continue;
        }

        try {
          const output: unknown = await tool.invoke(call.args ?? {});
          const framesPayload = parseWatchFramesPayload(output);
          if (framesPayload !== null) {
            results.push(new ToolMessage({ content: framesPayload.summary, tool_call_id: call.id, name: call.name }));
            results.push(buildWatchFramesMessage(call.name, framesPayload));
            continue;
          }
          const content = typeof output === 'string' ? output : JSON.stringify(output);
          results.push(new ToolMessage({ content, tool_call_id: call.id, name: call.name }));
        } catch (err) {
          const detail = err instanceof Error ? err.message : String(err);
          results.push(new ToolMessage({ content: `Tool "${call.name}" failed: ${detail}`, tool_call_id: call.id, name: call.name }));
        }
      }
      return { messages: results };
    })
    .addEdge(START, 'agent')
    .addConditionalEdges('agent', (state) => {
      const last = state.messages[state.messages.length - 1];
      if (last && isAiLike(last) && last.tool_calls && last.tool_calls.length > 0) {
        return 'checkApproval';
      }
      return END;
    })
    .addEdge('checkApproval', 'executeTools')
    .addEdge('executeTools', 'agent');

  const checkpointer = new MemorySaver();
  const graph = builder.compile({ checkpointer });
  // Compaction summarizes with the conversation's own model, so the session
  // manager needs the same factory the graph uses.
  return { graph, checkpointer, createModel: options.createModel };
}

export { isHumanMessage, isAiLike, isSystemMessage, isToolMessage };
export type AgentChatGraphBundle = ReturnType<typeof buildAgentChatGraph>;
export type AgentChatGraph = AgentChatGraphBundle['graph'];
