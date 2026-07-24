import { Command, INTERRUPT, isInterrupted } from '@langchain/langgraph';
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
import { isAiLike, isHumanMessage, isToolMessage, type AgentChatGraphBundle } from './agentChatGraph';

interface ConversationConfig {
  readonly modelId: string;
  readonly ollamaBaseUrl: string | undefined;
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
    this.conversationConfigs.set(input.conversationId, { modelId: input.modelId, ollamaBaseUrl: input.ollamaBaseUrl });
    const { HumanMessage } = await import('@langchain/core/messages');

    try {
      const result = await this.graph.invoke(
        { messages: [new HumanMessage(input.text)] },
        this.runnableConfig(input.conversationId)
      );
      return await this.toTurnState(input.conversationId, result);
    } catch (err) {
      return this.errorState(input.conversationId, err);
    }
  }

  async respondToApproval(input: AgentChatApprovalInput): Promise<AgentChatTurnState> {
    try {
      const result = await this.graph.invoke(
        new Command({ resume: input.decision }),
        this.runnableConfig(input.conversationId)
      );
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
        ollamaBaseUrl: stored?.ollamaBaseUrl
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
