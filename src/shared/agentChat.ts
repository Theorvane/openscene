import type { EditAgentContextAsset, EditAgentProjectContext } from './editAgentContext';
import type { OpenAiAuthMode, ReasoningEffort } from './openAiAuth';

export type AgentChatMessageRole = 'user' | 'assistant' | 'tool';

export interface AgentChatDisplayMessage {
  readonly id: string;
  readonly role: AgentChatMessageRole;
  readonly text: string;
  readonly toolName?: string | undefined;
}

export interface AgentToolCallProposal {
  readonly toolCallId: string;
  readonly toolName: string;
  readonly args: Record<string, unknown>;
}

export type AgentChatStatus = 'idle' | 'thinking' | 'awaiting-approval' | 'error';

export interface AgentChatTurnState {
  readonly conversationId: string;
  readonly messages: readonly AgentChatDisplayMessage[];
  readonly pendingApproval: AgentToolCallProposal | null;
  readonly status: AgentChatStatus;
  readonly error?: string | undefined;
}

export interface AgentChatSendInput {
  readonly conversationId: string;
  readonly text: string;
  readonly modelId: string;
  readonly openAiAuthMode?: OpenAiAuthMode | undefined;
  readonly reasoningEffort?: ReasoningEffort | undefined;
  readonly ollamaBaseUrl?: string | undefined;
  readonly contextAssets?: readonly EditAgentContextAsset[] | undefined;
  readonly activeProject?: EditAgentProjectContext | undefined;
  /**
   * Transcript restored from persisted chat history. When the in-memory
   * conversation thread is empty (e.g. after a relaunch), these messages
   * re-seed the model so the conversation can continue where it left off.
   */
  readonly restoredMessages?: readonly AgentChatDisplayMessage[] | undefined;
}

export type AgentToolApprovalDecision = 'approve' | 'deny';

export interface AgentChatApprovalInput {
  readonly conversationId: string;
  readonly toolCallId: string;
  readonly decision: AgentToolApprovalDecision;
}

export interface AgentChatResetInput {
  readonly conversationId: string;
}

/** One persisted Edit Agent conversation, stored inside its project folder. */
export interface AgentChatStoredConversation {
  readonly id: string;
  readonly title: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly messages: readonly AgentChatDisplayMessage[];
}

/** Path-free summary row for the home screen chat history list. */
export interface AgentChatHistoryEntry {
  readonly projectId: string;
  readonly projectName: string;
  readonly conversationId: string;
  readonly title: string;
  readonly updatedAt: string;
  readonly messageCount: number;
}

export interface AgentChatHistoryGetInput {
  readonly projectId: string;
  readonly conversationId: string;
}
