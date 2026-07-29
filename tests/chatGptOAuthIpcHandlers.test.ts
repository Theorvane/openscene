import { describe, expect, it, vi } from 'vitest';

import { registerChatGptOAuthIpcHandlers } from '../src/main/registerChatGptOAuthIpcHandlers';
import { IPC_CHANNELS } from '../src/shared/ipc';
import type { ApiResponse } from '../src/shared/models';
import type { ChatGptOAuthStatus } from '../src/shared/openAiAuth';

type RegisteredHandler = (payload?: unknown) => Promise<ApiResponse<ChatGptOAuthStatus>>;

const CONNECTED: ChatGptOAuthStatus = { kind: 'connected' };
const DISCONNECTED: ChatGptOAuthStatus = { kind: 'disconnected' };

function createFixture() {
  const handlers = new Map<string, RegisteredHandler>();
  const service = {
    getStatus: vi.fn(async () => CONNECTED),
    authorize: vi.fn(async () => CONNECTED),
    cancelAuthorization: vi.fn(),
    logout: vi.fn(async () => DISCONNECTED)
  };
  registerChatGptOAuthIpcHandlers({
    service,
    registerHandler: (channel, handler) => handlers.set(channel, handler)
  });
  return { handlers, service };
}

function getHandler(handlers: Map<string, RegisteredHandler>, channel: string): RegisteredHandler {
  const handler = handlers.get(channel);
  if (handler === undefined) {
    throw new Error(`The ChatGPT OAuth handler for ${channel} was not registered.`);
  }
  return handler;
}

describe('registerChatGptOAuthIpcHandlers', () => {
  it('returns the coarse service status when the status channel receives no payload', async () => {
    // Given
    const { handlers, service } = createFixture();
    const handler = getHandler(handlers, IPC_CHANNELS.getChatGptOAuthStatus);

    // When
    const response = await handler();

    // Then
    expect(response).toEqual({ ok: true, value: CONNECTED });
    expect(service.getStatus).toHaveBeenCalledTimes(1);
  });

  it('starts authorization when the start channel receives no payload', async () => {
    // Given
    const { handlers, service } = createFixture();
    const handler = getHandler(handlers, IPC_CHANNELS.startChatGptOAuth);

    // When
    const response = await handler();

    // Then
    expect(response).toEqual({ ok: true, value: CONNECTED });
    expect(service.authorize).toHaveBeenCalledTimes(1);
  });

  it('cancels an active authorization and returns the current coarse status', async () => {
    // Given
    const { handlers, service } = createFixture();
    const handler = getHandler(handlers, IPC_CHANNELS.cancelChatGptOAuth);

    // When
    const response = await handler();

    // Then
    expect(response).toEqual({ ok: true, value: CONNECTED });
    expect(service.cancelAuthorization).toHaveBeenCalledTimes(1);
    expect(service.getStatus).toHaveBeenCalledTimes(1);
  });

  it('logs out when the logout channel receives no payload', async () => {
    // Given
    const { handlers, service } = createFixture();
    const handler = getHandler(handlers, IPC_CHANNELS.logoutChatGptOAuth);

    // When
    const response = await handler();

    // Then
    expect(response).toEqual({ ok: true, value: DISCONNECTED });
    expect(service.logout).toHaveBeenCalledTimes(1);
  });

  it('rejects unexpected payload data before invoking the OAuth service', async () => {
    // Given
    const { handlers, service } = createFixture();
    const handler = getHandler(handlers, IPC_CHANNELS.startChatGptOAuth);

    // When
    const response = await handler({ accessToken: 'must-not-cross-ipc' });

    // Then
    expect(response).toEqual({
      ok: false,
      error: { code: 'INVALID_INPUT', message: 'ChatGPT OAuth actions do not accept a payload.' }
    });
    expect(service.authorize).not.toHaveBeenCalled();
  });
});
