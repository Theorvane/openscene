import { Command, INTERRUPT, isInterrupted, type StateSnapshot } from '@langchain/langgraph';
import type { AgentChatCompactInput } from '../shared/agentChat';
import type { AgentChatContextUsage } from '../shared/agentChat';
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
import { getDomainModel } from '../shared/aiDomainModels';
import { buildContextUsage, type TurnTokenUsage } from '../shared/agentChatUsage';
import type { OpenAiAuthMode, ReasoningEffort } from '../shared/openAiAuth';
import { isAiLike, isHumanMessage, isSystemMessage, isToolMessage, type AgentChatGraphBundle } from './agentChatGraph';

interface ConversationConfig {
  readonly modelId: string;
  readonly openAiAuthMode: OpenAiAuthMode | undefined;
  readonly reasoningEffort: ReasoningEffort | undefined;
  readonly ollamaBaseUrl: string | undefined;
  readonly contextAssets: readonly EditAgentContextAsset[];
  readonly activeProject: EditAgentProjectContext | null;
}

export class AgentChatSessionManager {
  private readonly graph: AgentChatGraphBundle['graph'];
  private readonly checkpointer: MemorySaver;
  private readonly createModel: AgentChatGraphBundle['createModel'];
  private readonly conversationConfigs = new Map<string, ConversationConfig>();

  constructor(bundle: AgentChatGraphBundle) {
    this.graph = bundle.graph;
    this.checkpointer = bundle.checkpointer;
    this.createModel = bundle.createModel;
  }

  async sendMessage(input: AgentChatSendInput): Promise<AgentChatTurnState> {
    this.conversationConfigs.set(input.conversationId, {
      modelId: input.modelId,
      openAiAuthMode: input.openAiAuthMode,
      reasoningEffort: input.reasoningEffort,
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

      if (input.feedback !== undefined && input.feedback.trim().length > 0) {
        await this.graph.updateState(config, { toolFeedback: { [input.toolCallId]: input.feedback } });
      }
      const result = await this.graph.invoke(new Command({ resume: input.decision }), config);
      return await this.toTurnState(input.conversationId, result);
    } catch (err) {
      return this.errorState(input.conversationId, err);
    }
  }

  /**
   * Summarizes the conversation and restarts the thread from that summary plus
   * the most recent turns, so a long session can keep going instead of hitting
   * the model's context window. Mirrors opencode's compaction: a structured
   * summary replaces the old history, the recent tail stays verbatim.
   */
  async compactConversation(input: AgentChatCompactInput): Promise<AgentChatTurnState> {
    const config = this.runnableConfig(input.conversationId);
    const stored = this.conversationConfigs.get(input.conversationId);
    if (stored === undefined) {
      return this.errorState(input.conversationId, new Error('This conversation has nothing to compact yet.'));
    }

    try {
      const snapshot = await this.graph.getState(config);
      const messages = ((snapshot.values as { messages?: BaseMessage[] } | undefined)?.messages ?? []) as BaseMessage[];
      const conversation = messages.filter((message) => !isSystemMessage(message));
      if (conversation.length <= COMPACTION_KEEP_RECENT) {
        return this.errorState(input.conversationId, new Error('This conversation is too short to compact.'));
      }

      const { HumanMessage } = await import('@langchain/core/messages');
      const older = conversation.slice(0, conversation.length - COMPACTION_KEEP_RECENT);
      const recent = conversation.slice(conversation.length - COMPACTION_KEEP_RECENT);

      const model = this.createModel({
        modelId: stored.modelId,
        openAiAuthMode: stored.openAiAuthMode,
        reasoningEffort: stored.reasoningEffort,
        ollamaBaseUrl: stored.ollamaBaseUrl
      });
      const summaryReply = await model.invoke([
        new HumanMessage(`${COMPACTION_PROMPT}\n\n<conversation>\n${transcriptForSummary(older)}\n</conversation>`)
      ]);
      const summary = contentToText(summaryReply.content).trim();
      if (summary.length === 0) {
        return this.errorState(input.conversationId, new Error('The model returned an empty summary; nothing was compacted.'));
      }

      // Restart the thread so the old turns stop being resent, then seed it
      // with the summary followed by the untouched recent tail.
      await this.checkpointer.deleteThread(input.conversationId);
      const seeded = [new HumanMessage(`${COMPACTION_SUMMARY_PREFIX}\n\n${summary}`), ...recent];
      await this.graph.updateState(config, { messages: seeded });

      const state = await this.graph.getState(config);
      const compacted = ((state.values as { messages?: BaseMessage[] } | undefined)?.messages ?? []) as BaseMessage[];
      return {
        conversationId: input.conversationId,
        messages: toDisplayMessages(compacted),
        pendingApproval: null,
        status: 'idle'
      };
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
        openAiAuthMode: stored?.openAiAuthMode,
        reasoningEffort: stored?.reasoningEffort,
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
        status: 'awaiting-approval',
        ...this.contextUsageFor(conversationId, messages)
      };
    }

    const messages = ((invokeResult as { messages?: BaseMessage[] } | undefined)?.messages ?? []) as BaseMessage[];
    return {
      conversationId,
      messages: toDisplayMessages(messages),
      pendingApproval: null,
      status: 'idle',
      ...this.contextUsageFor(conversationId, messages)
    };
  }

  /**
   * Context size comes from the newest turn that reported usage: provider
   * prompt tokens already cover the whole conversation, so the latest total is
   * the current context, not a running sum.
   */
  private contextUsageFor(conversationId: string, messages: readonly BaseMessage[]): { contextUsage?: AgentChatContextUsage } {
    const usage = latestTokenUsage(messages);
    const modelId = this.conversationConfigs.get(conversationId)?.modelId;
    const contextWindow = modelId === undefined ? undefined : getDomainModel('edit-agent', modelId)?.contextWindow;
    const contextUsage = buildContextUsage(usage, contextWindow);
    return contextUsage === undefined ? {} : { contextUsage };
  }

  /**
   * A failed turn reports the error over the conversation that already exists —
   * returning an empty transcript here made the panel blank the whole chat, so
   * a single provider error looked like the conversation was lost.
   */
  private async errorState(conversationId: string, err: unknown): Promise<AgentChatTurnState> {
    const snapshot = await this.graph.getState(this.runnableConfig(conversationId)).catch(() => null);
    const messages = ((snapshot?.values as { messages?: BaseMessage[] } | undefined)?.messages ?? []) as BaseMessage[];
    return {
      conversationId,
      messages: toDisplayMessages(messages),
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

/** How many trailing messages survive a compaction verbatim. */
const COMPACTION_KEEP_RECENT = 6;

const COMPACTION_SUMMARY_PREFIX = '[Compacted conversation summary]';

const COMPACTION_PROMPT =
  'Summarize the video-editing conversation below so it can continue with the history dropped. ' +
  'Output exactly these Markdown sections, in this order, and nothing else:\n' +
  '## Objective\n## Important details\n## Work state\n## Next move\n' +
  'Under each, use short bullets, or "(none)". Keep project ids, asset ids, clip ids, and timings ' +
  'exactly as written — they are how the tools address things.';

/** Plain transcript of the turns being folded into a summary. */
function transcriptForSummary(messages: readonly BaseMessage[]): string {
  return messages
    .map((message) => {
      const text = contentToText(message.content).trim();
      if (text.length === 0) return '';
      const role = isHumanMessage(message) ? 'user' : isToolMessage(message) ? 'tool' : 'assistant';
      // Tool payloads are the bulk of a long session and the least reusable.
      const body = role === 'tool' && text.length > 500 ? `${text.slice(0, 500)}\n[truncated]` : text;
      return `${role}: ${body}`;
    })
    .filter((line) => line.length > 0)
    .join('\n\n');
}

/** Newest reported provider usage, however the adapter spells the field. */
function latestTokenUsage(messages: readonly BaseMessage[]): TurnTokenUsage | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message === undefined || !isAiLike(message)) continue;
    const usage = (message as unknown as { usage_metadata?: { input_tokens?: number; output_tokens?: number; total_tokens?: number } }).usage_metadata;
    if (usage === undefined) continue;
    const turn: TurnTokenUsage = {
      inputTokens: usage.input_tokens,
      outputTokens: usage.output_tokens,
      totalTokens: usage.total_tokens
    };
    if (turn.inputTokens !== undefined || turn.outputTokens !== undefined || turn.totalTokens !== undefined) return turn;
  }
  return undefined;
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
