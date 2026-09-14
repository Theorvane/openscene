import { CHATGPT_CODEX_DEVICE_AUTH } from './chatGptOAuthService';
import { IPC_CHANNELS } from '../shared/ipc';
import type { ApiResponse } from '../shared/models';
import type { ChatGptOAuthStatus } from '../shared/openAiAuth';
import { fail, ok } from './ipcResponses';

type ChatGptOAuthActions = {
  readonly getStatus: () => Promise<ChatGptOAuthStatus>;
  readonly startDeviceAuthorization: () => Promise<ChatGptOAuthStatus>;
  readonly cancelAuthorization: () => void;
  readonly logout: () => Promise<ChatGptOAuthStatus>;
};

type ChatGptOAuthIpcHandler = (payload?: unknown) => Promise<ApiResponse<unknown>>;

type ChatGptOAuthIpcDependencies = {
  readonly service: ChatGptOAuthActions;
  readonly openDeviceAuthorizationPage: (url: string) => Promise<void>;
  readonly registerHandler: (channel: string, handler: ChatGptOAuthIpcHandler) => void;
};

export function registerChatGptOAuthIpcHandlers(dependencies: ChatGptOAuthIpcDependencies): void {
  const runAction = async (
    payload: unknown,
    action: () => Promise<ChatGptOAuthStatus>
  ): Promise<ApiResponse<ChatGptOAuthStatus>> => {
    if (payload !== undefined) {
      return fail('INVALID_INPUT', 'ChatGPT OAuth actions do not accept a payload.');
    }
    try {
      return ok(await action());
    } catch (error: unknown) {
      return fail('UNKNOWN_ERROR', error instanceof Error ? error.message : 'ChatGPT OAuth action failed.');
    }
  };

  dependencies.registerHandler(IPC_CHANNELS.getChatGptOAuthStatus, (payload) =>
    runAction(payload, () => dependencies.service.getStatus()));
  dependencies.registerHandler(IPC_CHANNELS.startChatGptOAuth, (payload) =>
    runAction(payload, () => dependencies.service.startDeviceAuthorization()));
  dependencies.registerHandler(IPC_CHANNELS.cancelChatGptOAuth, (payload) =>
    runAction(payload, async () => {
      dependencies.service.cancelAuthorization();
      return dependencies.service.getStatus();
    }));
  dependencies.registerHandler(IPC_CHANNELS.logoutChatGptOAuth, (payload) =>
    runAction(payload, () => dependencies.service.logout()));
  dependencies.registerHandler(IPC_CHANNELS.openChatGptDeviceAuthorizationPage, async (payload) => {
    if (payload !== undefined) return fail('INVALID_INPUT', 'Codex device page actions do not accept a payload.');
    try {
      await dependencies.openDeviceAuthorizationPage(CHATGPT_CODEX_DEVICE_AUTH.verificationUrl);
      return ok({ opened: true });
    } catch (error: unknown) {
      return fail('UNKNOWN_ERROR', error instanceof Error ? error.message : 'Could not open the Codex device authorization page.');
    }
  });
}
