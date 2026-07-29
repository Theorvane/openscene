import type { IpcMain } from 'electron';

import type { AgentChatHistoryGetInput, AgentChatTurnState } from '../shared/agentChat';
import { IPC_CHANNELS } from '../shared/ipc';
import { fail, ok } from './ipcResponses';
import type { AgentChatHistoryStore } from './agentChatHistoryStore';
import type { AgentChatSessionManager } from './agentChatSession';

export function registerAgentChatIpcHandlers(
  ipcMain: IpcMain,
  sessions: AgentChatSessionManager,
  history: AgentChatHistoryStore | null = null
): void {
  const recordTurn = async (turn: AgentChatTurnState): Promise<void> => {
    if (history === null || turn.messages.length === 0) return;
    const activeProject = sessions.getActiveProject(turn.conversationId);
    if (activeProject === null) return;
    try {
      await history.record({
        projectId: activeProject.projectId,
        conversationId: turn.conversationId,
        messages: turn.messages
      });
    } catch {
      // Persisting history must never fail the chat turn itself.
    }
  };

  ipcMain.handle(IPC_CHANNELS.agentChatSend, async (_event, request) => {
    try {
      const turn = await sessions.sendMessage(request);
      await recordTurn(turn);
      return ok(turn);
    } catch (err) {
      return fail('UNKNOWN_ERROR', err instanceof Error ? err.message : 'Failed to send agent chat message');
    }
  });

  ipcMain.handle(IPC_CHANNELS.agentChatApprove, async (_event, request) => {
    try {
      const turn = await sessions.respondToApproval(request);
      await recordTurn(turn);
      return ok(turn);
    } catch (err) {
      return fail('UNKNOWN_ERROR', err instanceof Error ? err.message : 'Failed to record agent chat approval');
    }
  });

  ipcMain.handle(IPC_CHANNELS.agentChatCompact, async (_event, request) => {
    try {
      const turn = await sessions.compactConversation(request);
      await recordTurn(turn);
      return ok(turn);
    } catch (err) {
      return fail('UNKNOWN_ERROR', err instanceof Error ? err.message : 'Failed to compact the agent conversation');
    }
  });

  ipcMain.handle(IPC_CHANNELS.agentChatReset, async (_event, request) => {
    try {
      return ok(await sessions.resetConversation(request));
    } catch (err) {
      return fail('UNKNOWN_ERROR', err instanceof Error ? err.message : 'Failed to reset agent chat conversation');
    }
  });

  ipcMain.handle(IPC_CHANNELS.agentChatHistoryList, async () => {
    if (history === null) return ok([]);
    try {
      return ok(await history.listAllProjects());
    } catch (err) {
      return fail('UNKNOWN_ERROR', err instanceof Error ? err.message : 'Failed to list agent chat history');
    }
  });

  ipcMain.handle(IPC_CHANNELS.agentChatHistoryDelete, async (_event, request) => {
    if (history === null) return ok(false);
    const input = request as Partial<AgentChatHistoryGetInput> | undefined;
    if (typeof input?.projectId !== 'string' || typeof input.conversationId !== 'string') {
      return fail('INVALID_INPUT', 'The chat history delete payload was not valid.');
    }
    try {
      // Drop the in-memory thread too, so a deleted conversation cannot be
      // resumed by a panel still pointing at that id.
      await sessions.resetConversation({ conversationId: input.conversationId });
      return ok(await history.delete(input.projectId, input.conversationId));
    } catch (err) {
      return fail('UNKNOWN_ERROR', err instanceof Error ? err.message : 'Failed to delete the agent chat conversation');
    }
  });

  ipcMain.handle(IPC_CHANNELS.agentChatHistoryGet, async (_event, request) => {
    if (history === null) return ok(null);
    const input = request as Partial<AgentChatHistoryGetInput> | undefined;
    if (typeof input?.projectId !== 'string' || typeof input.conversationId !== 'string') {
      return fail('INVALID_INPUT', 'The chat history lookup payload was not valid.');
    }
    try {
      return ok(await history.get(input.projectId, input.conversationId));
    } catch (err) {
      return fail('UNKNOWN_ERROR', err instanceof Error ? err.message : 'Failed to load the agent chat conversation');
    }
  });
}
