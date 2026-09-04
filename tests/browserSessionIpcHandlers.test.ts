import { describe, expect, it, vi } from 'vitest';

import { registerBrowserSessionIpcHandlers } from '../src/main/registerBrowserSessionIpcHandlers';
import { IPC_CHANNELS } from '../src/shared/ipc';
import type { ApiResponse } from '../src/shared/models';

type Handler = (_event?: unknown, payload?: unknown) => Promise<ApiResponse<unknown>>;

function fixture() {
  const handlers = new Map<string, Handler>();
  const disconnected = { providerId: 'gemini' as const, kind: 'disconnected' as const, origin: 'https://gemini.google.com' };
  const service = {
    getStatuses: vi.fn(async () => [disconnected]),
    start: vi.fn(async () => ({ ...disconnected, kind: 'stored' as const })),
    clear: vi.fn(async () => disconnected)
  };
  registerBrowserSessionIpcHandlers({
    service,
    registerHandler: (channel, handler) => handlers.set(channel, handler)
  });
  return { handlers, service };
}

function handlerFor(handlers: Map<string, Handler>, channel: string): Handler {
  const handler = handlers.get(channel);
  if (handler === undefined) throw new Error(`Missing handler for ${channel}`);
  return handler;
}

describe('browser session IPC handlers', () => {
  it('returns only public statuses without accepting payload data', async () => {
    const { handlers, service } = fixture();
    await expect(handlerFor(handlers, IPC_CHANNELS.getBrowserSessionStatuses)()).resolves.toEqual({
      ok: true,
      value: [{ providerId: 'gemini', kind: 'disconnected', origin: 'https://gemini.google.com' }]
    });
    await expect(handlerFor(handlers, IPC_CHANNELS.getBrowserSessionStatuses)(undefined, { cookie: 'secret' })).resolves.toMatchObject({
      ok: false,
      error: { code: 'INVALID_INPUT' }
    });
    expect(service.getStatuses).toHaveBeenCalledTimes(1);
  });

  it('parses the provider before starting or clearing a session', async () => {
    const { handlers, service } = fixture();
    await handlerFor(handlers, IPC_CHANNELS.startBrowserSession)(undefined, 'gemini');
    await handlerFor(handlers, IPC_CHANNELS.clearBrowserSession)(undefined, 'gemini');
    expect(service.start).toHaveBeenCalledWith('gemini');
    expect(service.clear).toHaveBeenCalledWith('gemini');
  });

  it('rejects object payloads so cookie material cannot cross this bridge', async () => {
    const { handlers, service } = fixture();
    const response = await handlerFor(handlers, IPC_CHANNELS.startBrowserSession)(undefined, {
      providerId: 'gemini',
      cookies: [{ value: 'must-not-cross-ipc' }]
    });
    expect(response).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    expect(service.start).not.toHaveBeenCalled();
  });
});
