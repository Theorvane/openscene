import type { UpdaterCapability, UpdaterState } from '../shared/updater';

// Modelled on opencode's desktop updater controller: the main process owns one
// state machine, checks are single-flight, and the downloaded version is
// persisted so a relaunch that already carries it does not offer it again.

export type UpdaterCheckResult = {
  readonly updateAvailable: boolean;
  readonly version?: string | undefined;
};

export type UpdaterBackend = {
  checkForUpdates(): Promise<UpdaterCheckResult>;
  downloadUpdate(): Promise<unknown>;
  quitAndInstall(): void;
  openReleasePage(version: string): Promise<void>;
};

export type UpdaterReadyRecord = { readonly version: string };

export type UpdaterPersistence = {
  get(): UpdaterReadyRecord | undefined | Promise<UpdaterReadyRecord | undefined>;
  set(value: UpdaterReadyRecord): void | Promise<void>;
  clear(): void | Promise<void>;
};

export type UpdaterControllerInput = {
  readonly capability: UpdaterCapability;
  readonly currentVersion: string;
  readonly releaseUrlFor: (version: string) => string;
  readonly backend: UpdaterBackend;
  readonly persistence: UpdaterPersistence;
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createUpdaterController(input: UpdaterControllerInput) {
  let state: UpdaterState =
    input.capability.kind === 'none' ? { status: 'disabled', reason: input.capability.reason } : { status: 'idle' };
  let pending: Promise<UpdaterState> | undefined;
  const listeners = new Set<(state: UpdaterState) => void>();

  const transition = (next: UpdaterState): UpdaterState => {
    state = next;
    for (const listener of listeners) {
      listener(state);
    }
    return state;
  };

  const check = (): Promise<UpdaterState> => {
    if (input.capability.kind === 'none') return Promise.resolve(state);
    // Already downloaded, or already known-and-unreachable: checking again
    // would only replace a useful answer with the same one.
    if (state.status === 'ready' || state.status === 'available') return Promise.resolve(state);
    if (pending) return pending;

    pending = (async () => {
      transition({ status: 'checking' });
      const result = await input.backend.checkForUpdates();
      const version = result.version;

      if (!result.updateAvailable || version === undefined || version === input.currentVersion) {
        await input.persistence.clear();
        return transition({ status: 'up-to-date' });
      }

      // Detection needs no signature, so every capable platform gets this far.
      // Only applying the update is gated.
      if (input.capability.kind === 'notify') {
        return transition({ status: 'available', version, releaseUrl: input.releaseUrlFor(version) });
      }

      transition({ status: 'downloading', version });
      await input.backend.downloadUpdate();
      await input.persistence.set({ version });
      return transition({ status: 'ready', version });
    })()
      .catch((error: unknown) => transition({ status: 'error', message: errorMessage(error) }))
      .finally(() => {
        pending = undefined;
      });

    return pending;
  };

  return {
    getState: (): UpdaterState => state,

    subscribe(listener: (state: UpdaterState) => void): () => void {
      listeners.add(listener);
      listener(state);
      return () => {
        listeners.delete(listener);
      };
    },

    async start(): Promise<UpdaterState> {
      // A record naming the version we are already running means the last
      // install succeeded; clearing it stops the app offering itself.
      const ready = await input.persistence.get();
      if (ready?.version === input.currentVersion) await input.persistence.clear();
      return check();
    },

    check,

    async install(): Promise<void> {
      if (state.status === 'available') {
        await input.backend.openReleasePage(state.version);
        return;
      }
      if (state.status !== 'ready') {
        throw new Error('No downloaded update is waiting to be installed.');
      }

      const { version } = state;
      transition({ status: 'installing', version });
      try {
        input.backend.quitAndInstall();
      } catch (error: unknown) {
        // The app is still running, so the update is still merely ready.
        transition({ status: 'ready', version });
        throw error;
      }
    }
  };
}

export type UpdaterController = ReturnType<typeof createUpdaterController>;
