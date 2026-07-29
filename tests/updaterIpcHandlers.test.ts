import { describe, expect, it, vi } from 'vitest';
import type { BrowserWindow, IpcMain } from 'electron';

import { registerUpdaterIpcHandlers } from '../src/main/updaterIpcHandlers';
import type { UpdaterController } from '../src/main/updaterController';
import { IPC_CHANNELS } from '../src/shared/ipc';
import type { UpdaterState } from '../src/shared/updater';

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

function createFakeWindow(destroyed = false) {
  const sent: { channel: string; payload: unknown }[] = [];
  const window = {
    isDestroyed: () => destroyed,
    webContents: {
      send: (channel: string, payload: unknown) => {
        sent.push({ channel, payload });
      }
    }
  } as unknown as BrowserWindow;
  return { window, sent };
}

function createFakeController(initial: UpdaterState = { status: 'idle' }) {
  let state = initial;
  const listeners = new Set<(state: UpdaterState) => void>();
  const controller = {
    getState: () => state,
    subscribe: (listener: (state: UpdaterState) => void) => {
      listeners.add(listener);
      listener(state);
      return () => listeners.delete(listener);
    },
    check: vi.fn(async () => state),
    install: vi.fn(async () => undefined),
    start: vi.fn(async () => state)
  } as unknown as UpdaterController;

  return {
    controller,
    emit(next: UpdaterState) {
      state = next;
      for (const listener of listeners) listener(next);
    }
  };
}

describe('registerUpdaterIpcHandlers', () => {
  it('answers a state request with the controller state and the running version', async () => {
    // Given
    const { ipcMain, handlers } = createFakeIpcMain();
    const { controller } = createFakeController({ status: 'up-to-date' });
    registerUpdaterIpcHandlers(ipcMain, { controller, currentVersion: '0.1.0', listWindows: () => [] });

    // When
    const response = await handlers.get(IPC_CHANNELS.updaterGetState)!(null);

    // Then
    expect(response).toEqual({ ok: true, value: { state: { status: 'up-to-date' }, currentVersion: '0.1.0' } });
  });

  it('reports an install failure as a failed response instead of throwing across the bridge', async () => {
    // Given
    const { ipcMain, handlers } = createFakeIpcMain();
    const { controller } = createFakeController();
    (controller.install as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('Could not get code signature for running application')
    );
    registerUpdaterIpcHandlers(ipcMain, { controller, currentVersion: '0.1.0', listWindows: () => [] });

    // When
    const response = (await handlers.get(IPC_CHANNELS.updaterInstall)!(null)) as {
      ok: boolean;
      error?: { message: string };
    };

    // Then
    expect(response.ok).toBe(false);
    expect(response.error?.message).toMatch(/code signature/);
  });

  it('pushes every state change to live windows', () => {
    // Given
    const { ipcMain } = createFakeIpcMain();
    const { controller, emit } = createFakeController();
    const live = createFakeWindow();
    registerUpdaterIpcHandlers(ipcMain, {
      controller,
      currentVersion: '0.1.0',
      listWindows: () => [live.window]
    });

    // When
    emit({ status: 'downloading', version: '0.2.0' });

    // Then
    // The subscribe call replays the current state first, so the download is second.
    expect(live.sent.map((entry) => entry.channel)).toEqual([
      IPC_CHANNELS.updaterStateChanged,
      IPC_CHANNELS.updaterStateChanged
    ]);
    expect(live.sent[1]?.payload).toEqual({
      state: { status: 'downloading', version: '0.2.0' },
      currentVersion: '0.1.0'
    });
  });

  it('does not send into a destroyed window', () => {
    // Given
    const { ipcMain } = createFakeIpcMain();
    const { controller, emit } = createFakeController();
    const dead = createFakeWindow(true);
    registerUpdaterIpcHandlers(ipcMain, {
      controller,
      currentVersion: '0.1.0',
      listWindows: () => [dead.window]
    });

    // When
    emit({ status: 'ready', version: '0.2.0' });

    // Then
    expect(dead.sent).toEqual([]);
  });

  it('stops pushing once the returned unsubscribe runs', () => {
    // Given
    const { ipcMain } = createFakeIpcMain();
    const { controller, emit } = createFakeController();
    const live = createFakeWindow();
    const unsubscribe = registerUpdaterIpcHandlers(ipcMain, {
      controller,
      currentVersion: '0.1.0',
      listWindows: () => [live.window]
    });

    // When
    unsubscribe();
    emit({ status: 'ready', version: '0.2.0' });

    // Then
    expect(live.sent).toHaveLength(1);
  });
});
