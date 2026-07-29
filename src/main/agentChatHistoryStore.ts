import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

import type {
  AgentChatDisplayMessage,
  AgentChatHistoryEntry,
  AgentChatMessageRole,
  AgentChatStoredConversation
} from '../shared/agentChat';
import type { ProjectStore } from './projectStore';

export const AGENT_CHAT_HISTORY_FILE_NAME = 'chats.json';
const HISTORY_SCHEMA_VERSION = 1;
const MAX_CONVERSATIONS_PER_PROJECT = 100;
const MAX_MESSAGES_PER_CONVERSATION = 400;
const MAX_TITLE_LENGTH = 80;

const MESSAGE_ROLES: readonly AgentChatMessageRole[] = ['user', 'assistant', 'tool'];

type PersistedHistoryFile = {
  readonly schemaVersion: number;
  readonly conversations: readonly AgentChatStoredConversation[];
};

export type RecordAgentChatInput = {
  readonly projectId: string;
  readonly conversationId: string;
  readonly messages: readonly AgentChatDisplayMessage[];
};

/**
 * Persists Edit Agent conversations as a path-free chats.json inside each
 * project folder, mirroring the project.json hardening: directories are only
 * resolved through the ProjectStore, writes are atomic tmp+rename, and a
 * hostile or corrupt history file degrades to an empty history instead of
 * crashing or leaking content.
 */
export class AgentChatHistoryStore {
  private readonly projects: ProjectStore;

  constructor(projects: ProjectStore) {
    this.projects = projects;
  }

  async record(input: RecordAgentChatInput, now = new Date()): Promise<void> {
    const messages = sanitizeMessages(input.messages);
    const title = deriveTitle(messages);
    if (title === null) return;

    const directory = await this.projects.resolveDirectory(input.projectId);
    const conversations = await readHistoryFile(directory);
    const existing = conversations.find((conversation) => conversation.id === input.conversationId);
    const timestamp = now.toISOString();
    const updated: AgentChatStoredConversation = {
      id: input.conversationId,
      title,
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp,
      messages
    };
    const next = [updated, ...conversations.filter((conversation) => conversation.id !== input.conversationId)]
      .slice(0, MAX_CONVERSATIONS_PER_PROJECT);
    await writeHistoryFile(directory, next);
  }

  async list(projectId: string): Promise<readonly AgentChatStoredConversation[]> {
    const directory = await this.projects.resolveDirectory(projectId);
    return readHistoryFile(directory);
  }

  async listAllProjects(): Promise<readonly AgentChatHistoryEntry[]> {
    const summaries = await this.projects.list();
    const entries: AgentChatHistoryEntry[] = [];
    for (const summary of summaries) {
      try {
        const conversations = await this.list(summary.id);
        for (const conversation of conversations) {
          entries.push({
            projectId: summary.id,
            projectName: summary.name,
            conversationId: conversation.id,
            title: conversation.title,
            updatedAt: conversation.updatedAt,
            messageCount: conversation.messages.length
          });
        }
      } catch {
        // A project folder that vanished or cannot be read hides its chats
        // rather than breaking the whole home screen list.
      }
    }
    return entries.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  async get(projectId: string, conversationId: string): Promise<AgentChatStoredConversation | null> {
    const conversations = await this.list(projectId);
    return conversations.find((conversation) => conversation.id === conversationId) ?? null;
  }

  /** Forgets one conversation. Returns false when it was already gone. */
  async delete(projectId: string, conversationId: string): Promise<boolean> {
    const directory = await this.projects.resolveDirectory(projectId);
    const conversations = await readHistoryFile(directory);
    const remaining = conversations.filter((conversation) => conversation.id !== conversationId);
    if (remaining.length === conversations.length) return false;
    await writeHistoryFile(directory, remaining);
    return true;
  }
}

function deriveTitle(messages: readonly AgentChatDisplayMessage[]): string | null {
  const firstUserText = messages.find((message) => message.role === 'user' && message.text.trim().length > 0);
  if (firstUserText === undefined) return null;
  const collapsed = firstUserText.text.replace(/\s+/g, ' ').trim();
  return collapsed.length > MAX_TITLE_LENGTH ? `${collapsed.slice(0, MAX_TITLE_LENGTH - 1)}…` : collapsed;
}

function sanitizeMessages(messages: readonly AgentChatDisplayMessage[]): readonly AgentChatDisplayMessage[] {
  return messages
    .filter((message) => MESSAGE_ROLES.includes(message.role) && typeof message.text === 'string')
    .slice(-MAX_MESSAGES_PER_CONVERSATION)
    .map((message, index) => ({
      id: `msg-${index}`,
      role: message.role,
      text: message.text,
      ...(message.toolName === undefined ? {} : { toolName: message.toolName })
    }));
}

async function readHistoryFile(directory: string): Promise<readonly AgentChatStoredConversation[]> {
  let raw: string;
  try {
    raw = await readFile(join(directory, AGENT_CHAT_HISTORY_FILE_NAME), 'utf8');
  } catch {
    return [];
  }
  try {
    return parseHistoryFile(JSON.parse(raw));
  } catch {
    return [];
  }
}

function parseHistoryFile(value: unknown): readonly AgentChatStoredConversation[] {
  if (typeof value !== 'object' || value === null) return [];
  const candidate = value as Partial<PersistedHistoryFile>;
  if (candidate.schemaVersion !== HISTORY_SCHEMA_VERSION || !Array.isArray(candidate.conversations)) return [];
  const conversations: AgentChatStoredConversation[] = [];
  for (const entry of candidate.conversations) {
    const conversation = parseConversation(entry);
    if (conversation !== null) conversations.push(conversation);
  }
  return conversations;
}

function parseConversation(value: unknown): AgentChatStoredConversation | null {
  if (typeof value !== 'object' || value === null) return null;
  const candidate = value as Partial<AgentChatStoredConversation>;
  if (typeof candidate.id !== 'string' || candidate.id.length === 0) return null;
  if (typeof candidate.title !== 'string' || candidate.title.length === 0) return null;
  if (typeof candidate.createdAt !== 'string' || typeof candidate.updatedAt !== 'string') return null;
  if (!Array.isArray(candidate.messages)) return null;
  const messages: AgentChatDisplayMessage[] = [];
  for (const message of candidate.messages) {
    if (typeof message !== 'object' || message === null) return null;
    const messageCandidate = message as Partial<AgentChatDisplayMessage>;
    if (typeof messageCandidate.id !== 'string') return null;
    if (!MESSAGE_ROLES.includes(messageCandidate.role as AgentChatMessageRole)) return null;
    if (typeof messageCandidate.text !== 'string') return null;
    if (messageCandidate.toolName !== undefined && typeof messageCandidate.toolName !== 'string') return null;
    messages.push({
      id: messageCandidate.id,
      role: messageCandidate.role as AgentChatMessageRole,
      text: messageCandidate.text,
      ...(messageCandidate.toolName === undefined ? {} : { toolName: messageCandidate.toolName })
    });
  }
  return {
    id: candidate.id,
    title: candidate.title,
    createdAt: candidate.createdAt,
    updatedAt: candidate.updatedAt,
    messages
  };
}

async function writeHistoryFile(directory: string, conversations: readonly AgentChatStoredConversation[]): Promise<void> {
  const payload: PersistedHistoryFile = { schemaVersion: HISTORY_SCHEMA_VERSION, conversations };
  const targetFile = join(directory, AGENT_CHAT_HISTORY_FILE_NAME);
  const temporaryFile = join(directory, `.${AGENT_CHAT_HISTORY_FILE_NAME}.${randomUUID()}.tmp`);
  await writeFile(temporaryFile, JSON.stringify(payload, null, 2), { encoding: 'utf8', mode: 0o600 });
  try {
    await rename(temporaryFile, targetFile);
  } catch (error) {
    await rm(temporaryFile, { force: true }).catch(() => undefined);
    throw error;
  }
}
