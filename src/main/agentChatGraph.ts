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

/**
 * The costing procedure the agent follows before spending the user's money.
 * Kept as a named export so the skill document and the tests describe the same
 * text rather than two drifting copies of it.
 */
export const GENERATION_COST_POLICY =
  'Generation spends real money on user provider account. Never start video generation from bare request. Order:\n' +
  '1. Length. Ask target length if user not said. Never assume.\n' +
  '2. Shots. Call planVideoScenario for legal shot lengths and start times. Never compute shot lengths yourself. ' +
  'Write one description per shot; repeat every continuity field in each shot prompt.\n' +
  '3. Price. Call estimateGenerationCost with every shot. Never state price from own knowledge \u2014 prices you ' +
  'recall are not real prices. Report exactly what tool returned, with as-of date, as estimate not quote.\n' +
  '4. Approve. Present total. Wait for user approval in a message. Plan approval and per-call tool approval are ' +
  'separate; both required. Any shot unpriced: name it, ask user to confirm they accept unknown charge.\n' +
  '5. Generate shot by shot.\n' +
  'Steps 3 and 4 output: write full clear prose, not compressed. User approves a charge and must not misread it.\n' +
  'User explicitly says skip estimate: do it, say plainly you generate without cost check. ' +
  'Same steps for image and speech at their scale.';

const AGENT_CHAT_SYSTEM_PROMPT =
  'OpenVideo in-app agent. You drive the whole editor through tools: read project timeline, add, trim, and remove ' +
  'clips, adjust clip effects, start FFmpeg export. ' +
  'You own generation end to end. To add generated media: call createVideoJob, createImageJob, or createSpeechJob, ' +
  'poll getJobStatus until completed, call importGeneratedResult, then place the returned assetId with ' +
  'addClipToTimeline. Never ask the user to do those steps by hand. ' +
  'Generation runs against the cloud provider connected in Settings; none connected fails with an explicit error. ' +
  'Report that error, never claim a provider works. ' +
  'createImageJob then createVideoJob with referenceImageJobId turns a still into a matching shot. ' +
  'watchProjectVideo samples frames into the conversation as timestamped images; use them to describe footage ' +
  '(vision-capable model required to see them). ' +
  'Keep replies short. Say what you do before calling a tool.' +
  '\n\n' +
  GENERATION_COST_POLICY;

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
  /** Charges the user's provider account; never auto-approved by "always". */
  readonly spendToolNames?: ReadonlySet<string>;
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
        // A spend tool re-asks even after "always": that answer was given about
        // one charge, and cannot stand in for consent to every later one.
        const spends = options.spendToolNames?.has(call.name) ?? false;
        if (!spends && state.alwaysAllowedTools.includes(call.name)) {
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
        .filter((name): name is string => name !== undefined)
        // Recording a spend tool here would make the next charge silent even
        // though this pass correctly stopped to ask about this one.
        .filter((name) => !(options.spendToolNames?.has(name) ?? false));
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
