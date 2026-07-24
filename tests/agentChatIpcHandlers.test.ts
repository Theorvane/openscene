import { describe, expect, it, vi } from 'vitest';
import type { IpcMain } from 'electron';
import { registerAgentChatIpcHandlers } from '../src/main/agentChatIpcHandlers';
import { IPC_CHANNELS } from '../src/shared/ipc';
import type { AgentChatSessionManager } from '../src/main/agentChatSession';
import type { AgentChatTurnState } from '../src/shared/agentChat';

type Listener = (event: unknown, ...args: unknown[]) => unknown;

function createFakeIpcMain(): { ipcMain: IpcMain; handlers: Map<string, Listener> } {
  const handlers = new Map<string, Listener>();
  const ipcMain = {
    handle: (channel: string, listener: Listener) => {
      handlers.set(channel, listener);
    }
  } as unknown as IpcMain;
  return { ipcMain, handlers };
}

const RESET_STATE: AgentChatTurnState = { conversationId: 'c1', messages: [], pendingApproval: null, status: 'idle' };

describe('registerAgentChatIpcHandlers', () => {
  it('resolves the resetConversation promise before wrapping it in ok() for the reset channel', async () => {
    const { ipcMain, handlers } = createFakeIpcMain();
    const sessions = {
      sendMessage: vi.fn(),
      respondToApproval: vi.fn(),
      // Reproduces the async, checkpointer-clearing reset — a caller that forgets to
      // await this must not leak the raw Promise into the IPC response's `value`.
      resetConversation: vi.fn(async () => {
        await Promise.resolve();
        return RESET_STATE;
      })
    } as unknown as AgentChatSessionManager;

    registerAgentChatIpcHandlers(ipcMain, sessions);
    const resetHandler = handlers.get(IPC_CHANNELS.agentChatReset);
    expect(resetHandler).toBeDefined();

    const response = await resetHandler!(null, { conversationId: 'c1' });

    expect(response).toEqual({ ok: true, value: RESET_STATE });
    // Guards specifically against `ok(sessions.resetConversation(request))` (missing await),
    // which would put an unresolved Promise in `value` instead of the turn state.
    expect(response).not.toHaveProperty('value.then');
    expect((response as { ok: true; value: AgentChatTurnState }).value.status).toBe('idle');
  });

  it('reports a failed reset as an error response instead of throwing', async () => {
    const { ipcMain, handlers } = createFakeIpcMain();
    const sessions = {
      sendMessage: vi.fn(),
      respondToApproval: vi.fn(),
      resetConversation: vi.fn(async () => {
        throw new Error('checkpointer unavailable');
      })
    } as unknown as AgentChatSessionManager;

    registerAgentChatIpcHandlers(ipcMain, sessions);
    const resetHandler = handlers.get(IPC_CHANNELS.agentChatReset)!;

    const response = await resetHandler(null, { conversationId: 'c1' });

    expect(response).toEqual({ ok: false, error: { code: 'UNKNOWN_ERROR', message: 'checkpointer unavailable' } });
  });

  it('resolves the sendMessage promise before wrapping it for the send channel', async () => {
    const { ipcMain, handlers } = createFakeIpcMain();
    const turnState: AgentChatTurnState = { conversationId: 'c1', messages: [], pendingApproval: null, status: 'thinking' };
    const sessions = {
      sendMessage: vi.fn(async () => turnState),
      respondToApproval: vi.fn(),
      resetConversation: vi.fn()
    } as unknown as AgentChatSessionManager;

    registerAgentChatIpcHandlers(ipcMain, sessions);
    const sendHandler = handlers.get(IPC_CHANNELS.agentChatSend)!;

    const response = await sendHandler(null, { conversationId: 'c1', text: 'hi', modelId: 'qwen2.5-coder' });

    expect(response).toEqual({ ok: true, value: turnState });
  });
});
