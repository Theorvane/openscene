import {
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

const AGENT_CHAT_SYSTEM_PROMPT =
  'You are the OpenVideo in-app agent. You can call the provided tools to check AI job status, ' +
  'start local AI video/speech generation, add a clip to a project timeline, or start an FFmpeg export. ' +
  'Only local mode is available in this build; never claim a cloud/API provider works. ' +
  'Keep replies short, and say what you are about to do before calling a tool.';

// isAIMessage narrows on `_getType() === 'ai'`, which is also true for the AIMessageChunk that
// chat model .invoke() calls actually return, so it doubles as our AI-message-of-either-kind check.
function isAiLike(message: BaseMessage): message is AIMessage {
  return isAIMessage(message);
}

export interface AgentChatModelHandle {
  invoke(messages: BaseMessage[]): Promise<AIMessage>;
}

export type AgentChatModelFactory = (config: { modelId: string; ollamaBaseUrl: string | undefined }) => AgentChatModelHandle;

const AgentChatState = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: (current, update) => current.concat(update),
    default: () => []
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
      const configurable = (config?.configurable ?? {}) as { modelId?: string; ollamaBaseUrl?: string };
      if (!configurable.modelId) {
        throw new Error('agentChatGraph: a modelId must be provided via config.configurable.');
      }

      const model = options.createModel({ modelId: configurable.modelId, ollamaBaseUrl: configurable.ollamaBaseUrl });
      const hasSystemPrompt = state.messages.length > 0 && isSystemMessage(state.messages[0]!);
      const messages = hasSystemPrompt ? state.messages : [new SystemMessage(AGENT_CHAT_SYSTEM_PROMPT), ...state.messages];

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
        const proposal: AgentToolCallProposal = {
          toolCallId: call.id,
          toolName: call.name,
          args: (call.args ?? {}) as Record<string, unknown>
        };
        decisions[call.id] = interrupt<AgentToolCallProposal, AgentToolApprovalDecision>(proposal);
      }
      return { toolDecisions: decisions };
    })
    .addNode('executeTools', async (state) => {
      const last = state.messages[state.messages.length - 1];
      if (!last || !isAiLike(last) || !last.tool_calls) {
        return { messages: [] };
      }

      const results: ToolMessage[] = [];
      for (const call of last.tool_calls) {
        if (!call.id) continue;

        const decision = options.mutatingToolNames.has(call.name) ? state.toolDecisions[call.id] : 'approve';
        if (decision !== 'approve') {
          results.push(new ToolMessage({ content: `User denied the "${call.name}" action.`, tool_call_id: call.id, name: call.name }));
          continue;
        }

        const tool = toolsByName.get(call.name);
        if (!tool) {
          results.push(new ToolMessage({ content: `Unknown tool "${call.name}".`, tool_call_id: call.id, name: call.name }));
          continue;
        }

        try {
          const output: unknown = await tool.invoke(call.args ?? {});
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
  return { graph, checkpointer };
}

export { isHumanMessage, isAiLike, isToolMessage };
export type AgentChatGraphBundle = ReturnType<typeof buildAgentChatGraph>;
export type AgentChatGraph = AgentChatGraphBundle['graph'];
