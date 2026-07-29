import { IPC_CHANNELS } from '../shared/ipc';
import type { ApiResponse } from '../shared/models';
import type { ChatGptOAuthStatus } from '../shared/openAiAuth';
import { fail, ok } from './ipcResponses';

type ChatGptOAuthActions = {
  readonly getStatus: () => Promise<ChatGptOAuthStatus>;
  readonly authorize: () => Promise<ChatGptOAuthStatus>;
  readonly cancelAuthorization: () => void;
  readonly logout: () => Promise<ChatGptOAuthStatus>;
};

type ChatGptOAuthIpcHandler = (payload?: unknown) => Promise<ApiResponse<ChatGptOAuthStatus>>;

type ChatGptOAuthIpcDependencies = {
  readonly service: ChatGptOAuthActions;
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
    runAction(payload, () => dependencies.service.authorize()));
  dependencies.registerHandler(IPC_CHANNELS.cancelChatGptOAuth, (payload) =>
    runAction(payload, async () => {
      dependencies.service.cancelAuthorization();
      return dependencies.service.getStatus();
    }));
  dependencies.registerHandler(IPC_CHANNELS.logoutChatGptOAuth, (payload) =>
    runAction(payload, () => dependencies.service.logout()));
}
