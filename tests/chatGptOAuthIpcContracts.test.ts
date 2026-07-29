import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

const SHARED_CONTRACT_URL = new URL('../src/shared/openAiAuth.ts', import.meta.url);
const IPC_CHANNELS_URL = new URL('../src/shared/ipc.ts', import.meta.url);
const PRELOAD_URL = new URL('../src/preload/index.ts', import.meta.url);
const MAIN_INDEX_URL = new URL('../src/main/index.ts', import.meta.url);
const IPC_HANDLER_URL = new URL('../src/main/registerChatGptOAuthIpcHandlers.ts', import.meta.url);

describe('ChatGPT OAuth renderer contract', () => {
  it('exposes only coarse OAuth actions and status when the renderer uses the preload bridge', async () => {
    // Given
    const [sharedContract, ipcChannels, preload, mainIndex, ipcHandler] = await Promise.all([
      readFile(SHARED_CONTRACT_URL, 'utf8'),
      readFile(IPC_CHANNELS_URL, 'utf8'),
      readFile(PRELOAD_URL, 'utf8'),
      readFile(MAIN_INDEX_URL, 'utf8'),
      readFile(IPC_HANDLER_URL, 'utf8')
    ]);

    // When
    const publicContract = `${sharedContract}\n${preload
      .split('\n')
      .filter((line) => line.includes('ChatGptOAuth'))
      .join('\n')}`;

    // Then
    expect(sharedContract).toContain("export type OpenAiAuthMode = 'api-key' | 'chatgpt';");
    expect(sharedContract).toContain('export type ChatGptOAuthStatus =');
    expect(ipcChannels).toContain("getChatGptOAuthStatus: 'chatgpt-oauth:status'");
    expect(ipcChannels).toContain("startChatGptOAuth: 'chatgpt-oauth:start'");
    expect(ipcChannels).toContain("cancelChatGptOAuth: 'chatgpt-oauth:cancel'");
    expect(ipcChannels).toContain("logoutChatGptOAuth: 'chatgpt-oauth:logout'");
    expect(preload).toContain('getChatGptOAuthStatus(): Promise<ApiResponse<ChatGptOAuthStatus>>;');
    expect(preload).toContain('startChatGptOAuth(): Promise<ApiResponse<ChatGptOAuthStatus>>;');
    expect(preload).toContain('cancelChatGptOAuth(): Promise<ApiResponse<ChatGptOAuthStatus>>;');
    expect(preload).toContain('logoutChatGptOAuth(): Promise<ApiResponse<ChatGptOAuthStatus>>;');
    expect(mainIndex).toContain("new ChatGptOAuthService(app.getPath('userData')");
    expect(mainIndex).toContain('openExternal: (url) => shell.openExternal(url)');
    expect(mainIndex).toContain('registerChatGptOAuthIpcHandlers({');
    expect(ipcHandler).toContain("return fail('INVALID_INPUT', 'ChatGPT OAuth actions do not accept a payload.');");
    expect(publicContract).not.toMatch(/accessToken|refreshToken|accountId|verifier|callback/i);
  });
});
