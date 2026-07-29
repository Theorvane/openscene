import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

const SOURCE_URLS = {
  authContext: new URL('../src/renderer/src/ChatGptAuthContext.tsx', import.meta.url),
  dialog: new URL('../src/renderer/src/ProviderConnectDialog.tsx', import.meta.url),
  settings: new URL('../src/renderer/src/SettingsWorkspace.tsx', import.meta.url),
  chatContext: new URL('../src/renderer/src/AgentChatContext.tsx', import.meta.url),
  picker: new URL('../src/renderer/src/AgentModelPicker.tsx', import.meta.url),
  pickerModel: new URL('../src/renderer/src/agentModelPickerModel.ts', import.meta.url)
} as const;

describe('unified OpenAI provider renderer contract', () => {
  it('drives ChatGPT sign-in through IPC without ever holding tokens in the renderer', async () => {
    const source = await readFile(SOURCE_URLS.authContext, 'utf8');

    expect(source).toContain('window.videoTool.getChatGptOAuthStatus()');
    expect(source).toContain('window.videoTool.startChatGptOAuth()');
    expect(source).toContain('window.videoTool.cancelChatGptOAuth()');
    expect(source).toContain('window.videoTool.logoutChatGptOAuth()');
    // A sign-in completes in the browser, so the status is re-read on focus
    // rather than trusting a single mount-time read.
    expect(source).toContain("window.addEventListener('focus', onFocus)");
    // Only a connected/disconnected status may cross the bridge.
    expect(source).not.toMatch(/accessToken|refreshToken|accountId|localStorage/);
  });

  it('offers the login-method step for providers with a sign-in', async () => {
    const [dialog, settings] = await Promise.all([
      readFile(SOURCE_URLS.dialog, 'utf8'),
      readFile(SOURCE_URLS.settings, 'utf8')
    ]);

    expect(dialog).toContain('Select a login method for');
    expect(dialog).toContain('provider-connect-dialog__method');
    expect(dialog).toContain("type=\"password\"");
    // OpenAI is one unified provider entry that carries the ChatGPT method.
    expect(settings).toContain('chatGptSignInMethod');
    expect(settings).toContain("connectTarget.id === 'openai' ? { oauthMethod: chatGptSignInMethod } : {}");
    expect(settings).toContain('ChatGPT Pro/Plus');
    expect(settings).toContain('Sign out of ChatGPT');
    expect(settings).not.toContain('OPENAI_CODEX_PROVIDER');
  });

  it('treats a ChatGPT sign-in as a connection for Codex models across chat surfaces', async () => {
    const [settings, chatContext, picker, pickerModel] = await Promise.all([
      readFile(SOURCE_URLS.settings, 'utf8'),
      readFile(SOURCE_URLS.chatContext, 'utf8'),
      readFile(SOURCE_URLS.picker, 'utf8'),
      readFile(SOURCE_URLS.pickerModel, 'utf8')
    ]);

    expect(settings).toContain('isProviderLinked');
    expect(chatContext).toContain('resolveOpenAiAuthMode(selectedModel.id, chatGptAuth.isConnected)');
    expect(chatContext).toContain('openAiAuthMode,');
    // The picker's list rule lives in a pure, unit-tested module.
    expect(picker).toContain('buildAgentModelGroups');
    expect(picker).toContain('chatGptConnected: chatGptAuth.isConnected');
    expect(pickerModel).toContain('isOpenAiCodexModelKey');
    // An OpenAI group carried only by a sign-in says so, so an empty-looking
    // model list is never a mystery.
    expect(pickerModel).toContain("linkedBySignIn ? 'ChatGPT' : 'Not connected'");
    // The hint distinguishes "nothing connected" from the impossible empty list,
    // so a stale build cannot masquerade as a missing connection.
    // The popover escapes the chat panel's overflow clipping via a portal.
    expect(picker).toContain('createPortal(popover, document.body)');
    // Context size is not shown on model rows.
    expect(picker).not.toContain('contextWindow');
    expect(picker).toContain('No models resolved — restart the app');
    expect(picker).toContain('Connect a provider in Settings → Providers to add its models here.');
  });
});
