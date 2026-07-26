import type { EditAgentContextAsset } from './editAgentContext';

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
  readonly ollamaBaseUrl?: string | undefined;
  readonly contextAssets?: readonly EditAgentContextAsset[] | undefined;
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
