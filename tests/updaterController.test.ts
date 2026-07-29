import { describe, expect, it, vi } from 'vitest';

import { createUpdaterController, type UpdaterControllerInput } from '../src/main/updaterController';
import type { UpdaterCapability, UpdaterState } from '../src/shared/updater';

function makeController(overrides: {
  capability?: UpdaterCapability;
  currentVersion?: string;
  checkForUpdates?: UpdaterControllerInput['backend']['checkForUpdates'];
  downloadUpdate?: UpdaterControllerInput['backend']['downloadUpdate'];
  quitAndInstall?: UpdaterControllerInput['backend']['quitAndInstall'];
  openReleasePage?: UpdaterControllerInput['backend']['openReleasePage'];
  stored?: { readonly version: string } | undefined;
} = {}) {
  let stored = overrides.stored;
  const backend = {
    checkForUpdates: overrides.checkForUpdates ?? vi.fn(async () => ({ updateAvailable: false })),
    downloadUpdate: overrides.downloadUpdate ?? vi.fn(async () => undefined),
    quitAndInstall: overrides.quitAndInstall ?? vi.fn(() => undefined),
    openReleasePage: overrides.openReleasePage ?? vi.fn(async () => undefined)
  };
  const persistence = {
    get: () => stored,
    set: (value: { readonly version: string }) => {
      stored = value;
    },
    clear: () => {
      stored = undefined;
    }
  };

  const controller = createUpdaterController({
    capability: overrides.capability ?? { kind: 'install' },
    currentVersion: overrides.currentVersion ?? '0.1.0',
    releaseUrlFor: (version) => `https://github.com/Theorvane/openvideo/releases/tag/v${version}`,
    backend,
    persistence
  });

  return { controller, backend, readStored: () => stored };
}

describe('updater controller', () => {
  it('reports disabled without ever calling the backend when there is no update path', () => {
    // Given
    const { controller, backend } = makeController({
      capability: { kind: 'none', reason: 'runs from source' }
    });

    // When / Then
    expect(controller.getState()).toEqual({ status: 'disabled', reason: 'runs from source' });
    expect(backend.checkForUpdates).not.toHaveBeenCalled();
  });

  it('downloads and holds an update ready when the platform can install it', async () => {
    // Given
    const { controller, backend, readStored } = makeController({
      checkForUpdates: vi.fn(async () => ({ updateAvailable: true, version: '0.2.0' }))
    });

    // When
    const state = await controller.check();

    // Then
    expect(state).toEqual({ status: 'ready', version: '0.2.0' });
    expect(backend.downloadUpdate).toHaveBeenCalledTimes(1);
    // Persisted so a relaunch carrying 0.2.0 does not offer it again.
    expect(readStored()).toEqual({ version: '0.2.0' });
  });

  it('reports an available version without downloading when the build cannot install it', async () => {
    // Given
    const { controller, backend, readStored } = makeController({
      capability: { kind: 'notify', reason: 'unsigned' },
      checkForUpdates: vi.fn(async () => ({ updateAvailable: true, version: '0.2.0' }))
    });

    // When
    const state = await controller.check();

    // Then
    expect(state).toEqual({
      status: 'available',
      version: '0.2.0',
      releaseUrl: 'https://github.com/Theorvane/openvideo/releases/tag/v0.2.0'
    });
    // Downloading an update that can never be applied wastes the user's
    // bandwidth and leaves a file nothing will ever read.
    expect(backend.downloadUpdate).not.toHaveBeenCalled();
    expect(readStored()).toBeUndefined();
  });

  it('treats a reported update that matches the running version as up to date', async () => {
    // Given
    const { controller, backend } = makeController({
      currentVersion: '0.2.0',
      checkForUpdates: vi.fn(async () => ({ updateAvailable: true, version: '0.2.0' }))
    });

    // When
    const state = await controller.check();

    // Then
    expect(state).toEqual({ status: 'up-to-date' });
    expect(backend.downloadUpdate).not.toHaveBeenCalled();
  });

  it('shares one in-flight check between concurrent callers', async () => {
    // Given
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const checkForUpdates = vi.fn(async () => {
      await gate;
      return { updateAvailable: false };
    });
    const { controller } = makeController({ checkForUpdates });

    // When
    const first = controller.check();
    const second = controller.check();
    release?.();
    await Promise.all([first, second]);

    // Then
    expect(checkForUpdates).toHaveBeenCalledTimes(1);
  });

  it('does not check again once an update is already downloaded', async () => {
    // Given
    const checkForUpdates = vi.fn(async () => ({ updateAvailable: true, version: '0.2.0' }));
    const { controller } = makeController({ checkForUpdates });
    await controller.check();

    // When
    const state = await controller.check();

    // Then
    expect(state).toEqual({ status: 'ready', version: '0.2.0' });
    expect(checkForUpdates).toHaveBeenCalledTimes(1);
  });

  it('turns a failed check into an error state a later check can retry from', async () => {
    // Given
    const checkForUpdates = vi
      .fn<() => Promise<{ updateAvailable: boolean; version?: string }>>()
      .mockRejectedValueOnce(new Error('ENOTFOUND github.com'))
      .mockResolvedValueOnce({ updateAvailable: false });
    const { controller } = makeController({ checkForUpdates });

    // When
    const failed = await controller.check();
    const retried = await controller.check();

    // Then
    expect(failed).toEqual({ status: 'error', message: 'ENOTFOUND github.com' });
    expect(retried).toEqual({ status: 'up-to-date' });
  });

  it('clears the stored version on start when it is the one already running', async () => {
    // Given
    const { controller, readStored } = makeController({
      currentVersion: '0.2.0',
      stored: { version: '0.2.0' }
    });

    // When
    await controller.start();

    // Then
    expect(readStored()).toBeUndefined();
  });

  it('publishes the current state to a new subscriber and on every transition', async () => {
    // Given
    const { controller } = makeController({
      checkForUpdates: vi.fn(async () => ({ updateAvailable: true, version: '0.2.0' }))
    });
    const seen: UpdaterState[] = [];

    // When
    const unsubscribe = controller.subscribe((state) => seen.push(state));
    await controller.check();
    unsubscribe();
    await controller.check();

    // Then
    expect(seen.map((state) => state.status)).toEqual(['idle', 'checking', 'downloading', 'ready']);
  });

  it('opens the release page instead of installing when the build cannot install', async () => {
    // Given
    const { controller, backend } = makeController({
      capability: { kind: 'notify', reason: 'unsigned' },
      checkForUpdates: vi.fn(async () => ({ updateAvailable: true, version: '0.2.0' }))
    });
    await controller.check();

    // When
    await controller.install();

    // Then
    expect(backend.openReleasePage).toHaveBeenCalledWith('0.2.0');
    expect(backend.quitAndInstall).not.toHaveBeenCalled();
  });

  it('refuses to install when nothing has been downloaded', async () => {
    // Given
    const { controller, backend } = makeController();

    // When / Then
    await expect(controller.install()).rejects.toThrow(/No downloaded update/);
    expect(backend.quitAndInstall).not.toHaveBeenCalled();
  });

  it('falls back to ready when the install throws, so the app is not stuck installing', async () => {
    // Given
    const { controller } = makeController({
      checkForUpdates: vi.fn(async () => ({ updateAvailable: true, version: '0.2.0' })),
      quitAndInstall: vi.fn(() => {
        throw new Error('Could not get code signature for running application');
      })
    });
    await controller.check();

    // When / Then
    await expect(controller.install()).rejects.toThrow(/code signature/);
    expect(controller.getState()).toEqual({ status: 'ready', version: '0.2.0' });
  });
});
