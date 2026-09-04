import { parseBrowserSessionProviderId, type BrowserSessionStatus } from '../shared/browserSession';
import { IPC_CHANNELS } from '../shared/ipc';
import type { ApiResponse } from '../shared/models';
import { fail, ok } from './ipcResponses';

type BrowserSessionActions = {
  readonly getStatuses: () => Promise<readonly BrowserSessionStatus[]>;
  readonly start: (providerId: BrowserSessionStatus['providerId']) => Promise<BrowserSessionStatus>;
  readonly clear: (providerId: BrowserSessionStatus['providerId']) => Promise<BrowserSessionStatus>;
};

type BrowserSessionIpcDependencies = {
  readonly service: BrowserSessionActions;
  readonly registerHandler: (channel: string, handler: (_event: unknown, payload?: unknown) => Promise<ApiResponse<unknown>>) => void;
};

export function registerBrowserSessionIpcHandlers(dependencies: BrowserSessionIpcDependencies): void {
  dependencies.registerHandler(IPC_CHANNELS.getBrowserSessionStatuses, async (_event, payload) => {
    if (payload !== undefined) {
      return fail('INVALID_INPUT', 'Browser session status does not accept a payload.');
    }
    try {
      return ok(await dependencies.service.getStatuses());
    } catch (error: unknown) {
      return fail('UNKNOWN_ERROR', error instanceof Error ? error.message : 'Could not read browser session status.');
    }
  });

  const providerAction = async (
    payload: unknown,
    action: BrowserSessionActions['start']
  ): Promise<ApiResponse<BrowserSessionStatus>> => {
    const providerId = parseBrowserSessionProviderId(payload);
    if (providerId === null) {
      return fail('INVALID_INPUT', 'Browser session provider must be gemini or grok.');
    }
    try {
      return ok(await action(providerId));
    } catch (error: unknown) {
      return fail('UNKNOWN_ERROR', error instanceof Error ? error.message : 'Browser session action failed.');
    }
  };

  dependencies.registerHandler(IPC_CHANNELS.startBrowserSession, (_event, payload) =>
    providerAction(payload, (providerId) => dependencies.service.start(providerId)));
  dependencies.registerHandler(IPC_CHANNELS.clearBrowserSession, (_event, payload) =>
    providerAction(payload, (providerId) => dependencies.service.clear(providerId)));
}
