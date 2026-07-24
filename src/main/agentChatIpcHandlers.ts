import type { IpcMain } from 'electron';

import { IPC_CHANNELS } from '../shared/ipc';
import { fail, ok } from './ipcResponses';
import type { AgentChatSessionManager } from './agentChatSession';

export function registerAgentChatIpcHandlers(ipcMain: IpcMain, sessions: AgentChatSessionManager): void {
  ipcMain.handle(IPC_CHANNELS.agentChatSend, async (_event, request) => {
    try {
      return ok(await sessions.sendMessage(request));
    } catch (err) {
      return fail('UNKNOWN_ERROR', err instanceof Error ? err.message : 'Failed to send agent chat message');
    }
  });

  ipcMain.handle(IPC_CHANNELS.agentChatApprove, async (_event, request) => {
    try {
      return ok(await sessions.respondToApproval(request));
    } catch (err) {
      return fail('UNKNOWN_ERROR', err instanceof Error ? err.message : 'Failed to record agent chat approval');
    }
  });

  ipcMain.handle(IPC_CHANNELS.agentChatReset, async (_event, request) => {
    try {
      return ok(await sessions.resetConversation(request));
    } catch (err) {
      return fail('UNKNOWN_ERROR', err instanceof Error ? err.message : 'Failed to reset agent chat conversation');
    }
  });
}
