import { Command, INTERRUPT, isInterrupted, type StateSnapshot } from '@langchain/langgraph';
import type { MemorySaver } from '@langchain/langgraph-checkpoint';
import type { BaseMessage } from '@langchain/core/messages';
import type {
  AgentChatApprovalInput,
  AgentChatDisplayMessage,
  AgentChatResetInput,
  AgentChatSendInput,
  AgentChatTurnState,
  AgentToolCallProposal
} from '../shared/agentChat';
import type { EditAgentContextAsset, EditAgentProjectContext } from '../shared/editAgentContext';
import { isAiLike, isHumanMessage, isToolMessage, type AgentChatGraphBundle } from './agentChatGraph';

interface ConversationConfig {
  readonly modelId: string;
  readonly ollamaBaseUrl: string | undefined;
  readonly contextAssets: readonly EditAgentContextAsset[];
  readonly activeProject: EditAgentProjectContext | null;
}

export class AgentChatSessionManager {
  private readonly graph: AgentChatGraphBundle['graph'];
  private readonly checkpointer: MemorySaver;
  private readonly conversationConfigs = new Map<string, ConversationConfig>();

  constructor(bundle: AgentChatGraphBundle) {
    this.graph = bundle.graph;
    this.checkpointer = bundle.checkpointer;
  }

  async sendMessage(input: AgentChatSendInput): Promise<AgentChatTurnState> {
    this.conversationConfigs.set(input.conversationId, {
      modelId: input.modelId,
      ollamaBaseUrl: input.ollamaBaseUrl,
      contextAssets: input.contextAssets ?? [],
      activeProject: input.activeProject ?? null
    });
    const { HumanMessage } = await import('@langchain/core/messages');

    try {
      const seed = await this.restoredSeed(input);
      const result = await this.graph.invoke(
        { messages: [...seed, new HumanMessage(input.text)] },
        this.runnableConfig(input.conversationId)
      );
      return await this.toTurnState(input.conversationId, result);
    } catch (err) {
      return this.errorState(input.conversationId, err);
    }
  }

  /** Project the given conversation is scoped to, if any. */
  getActiveProject(conversationId: string): EditAgentProjectContext | null {
    return this.conversationConfigs.get(conversationId)?.activeProject ?? null;
  }

  /**
   * When a conversation restored from persisted history continues after the
   * in-memory thread is gone (e.g. app relaunch), replay the transcript into
   * the empty thread so the model keeps its context. A thread that already
   * has messages wins over the restored copy.
   */
  private async restoredSeed(input: AgentChatSendInput): Promise<BaseMessage[]> {
    const restored = input.restoredMessages ?? [];
    if (restored.length === 0) return [];

    const snapshot = await this.graph.getState(this.runnableConfig(input.conversationId)).catch(() => null);
    const existing = ((snapshot?.values as { messages?: BaseMessage[] } | undefined)?.messages ?? []) as BaseMessage[];
    if (existing.length > 0) return [];

    const { AIMessage, HumanMessage } = await import('@langchain/core/messages');
    return restored
      .filter((message) => message.role !== 'tool' && message.text.trim().length > 0)
      .map((message) => (message.role === 'user' ? new HumanMessage(message.text) : new AIMessage(message.text)));
  }

  async respondToApproval(input: AgentChatApprovalInput): Promise<AgentChatTurnState> {
    const config = this.runnableConfig(input.conversationId);

    try {
      const snapshot = await this.graph.getState(config);
      const actualPending = findPendingProposal(snapshot);

      if (!actualPending || actualPending.toolCallId !== input.toolCallId) {
        const messages = ((snapshot.values as { messages?: BaseMessage[] } | undefined)?.messages ?? []) as BaseMessage[];
        return {
          conversationId: input.conversationId,
          messages: toDisplayMessages(messages),
          pendingApproval: actualPending,
          status: actualPending ? 'awaiting-approval' : 'idle',
          error: 'This approval no longer matches the agent\'s current pending action. Ignored.'
        };
      }

      const result = await this.graph.invoke(new Command({ resume: input.decision }), config);
      return await this.toTurnState(input.conversationId, result);
    } catch (err) {
      return this.errorState(input.conversationId, err);
    }
  }

  async resetConversation(input: AgentChatResetInput): Promise<AgentChatTurnState> {
    this.conversationConfigs.delete(input.conversationId);
    await this.checkpointer.deleteThread(input.conversationId);
    return { conversationId: input.conversationId, messages: [], pendingApproval: null, status: 'idle' };
  }

  private runnableConfig(conversationId: string): { configurable: Record<string, string | undefined> } {
    const stored = this.conversationConfigs.get(conversationId);
    return {
      configurable: {
        thread_id: conversationId,
        modelId: stored?.modelId,
        ollamaBaseUrl: stored?.ollamaBaseUrl,
        editAssetContext: JSON.stringify(stored?.contextAssets ?? []),
        editProjectContext: JSON.stringify(stored?.activeProject ?? null)
      }
    };
  }

  private async toTurnState(conversationId: string, invokeResult: unknown): Promise<AgentChatTurnState> {
    if (isInterrupted<AgentToolCallProposal>(invokeResult)) {
      const proposal = invokeResult[INTERRUPT][0]?.value ?? null;
      const snapshot = await this.graph.getState(this.runnableConfig(conversationId));
      const messages = ((snapshot.values as { messages?: BaseMessage[] } | undefined)?.messages ?? []) as BaseMessage[];
      return {
        conversationId,
        messages: toDisplayMessages(messages),
        pendingApproval: proposal,
        status: 'awaiting-approval'
      };
    }

    const messages = ((invokeResult as { messages?: BaseMessage[] } | undefined)?.messages ?? []) as BaseMessage[];
    return {
      conversationId,
      messages: toDisplayMessages(messages),
      pendingApproval: null,
      status: 'idle'
    };
  }

  private errorState(conversationId: string, err: unknown): AgentChatTurnState {
    return {
      conversationId,
      messages: [],
      pendingApproval: null,
      status: 'error',
      error: err instanceof Error ? err.message : 'Agent chat failed unexpectedly.'
    };
  }
}

function findPendingProposal(snapshot: StateSnapshot): AgentToolCallProposal | null {
  for (const task of snapshot.tasks) {
    for (const pendingInterrupt of task.interrupts) {
      if (pendingInterrupt.value) {
        return pendingInterrupt.value as AgentToolCallProposal;
      }
    }
  }
  return null;
}

function toDisplayMessages(messages: readonly BaseMessage[]): AgentChatDisplayMessage[] {
  const display: AgentChatDisplayMessage[] = [];

  messages.forEach((message, index) => {
    if (isHumanMessage(message)) {
      display.push({ id: `msg-${index}`, role: 'user', text: contentToText(message.content) });
      return;
    }
    if (isAiLike(message)) {
      const text = contentToText(message.content);
      if (text.trim().length > 0) {
        display.push({ id: `msg-${index}`, role: 'assistant', text });
      }
      return;
    }
    if (isToolMessage(message)) {
      display.push({
        id: `msg-${index}`,
        role: 'tool',
        text: contentToText(message.content),
        toolName: message.name
      });
    }
  });

  return display;
}

function contentToText(content: BaseMessage['content']): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part;
        if (part && typeof part === 'object' && 'text' in part && typeof (part as { text?: unknown }).text === 'string') {
          return (part as { text: string }).text;
        }
        return '';
      })
      .join('');
  }
  return '';
}
