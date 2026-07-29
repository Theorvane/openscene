import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

const SETTINGS_SOURCE_URL = new URL('../src/renderer/src/SettingsWorkspace.tsx', import.meta.url);

describe('Settings workspace source contract', () => {
  it('organizes settings into the requested local-first sections and reads only safe FFmpeg readiness', async () => {
    const source = await readFile(SETTINGS_SOURCE_URL, 'utf8');

    for (const heading of ['Appearance', 'Local Tools', 'Voice', 'Video', 'Providers', 'Models', 'Edit Agent', 'Data & Privacy']) {
      expect(source).toContain(`title: '${heading}'`);
    }
    expect(source).toContain('window.videoTool.getFfmpegRuntimeStatus');
    // Voice/video generation models are managed inside their workspaces now;
    // Settings keeps only the chat-model surfaces.
    expect(source).not.toContain('AiDomainModelSelector domain="voice-generation"');
    expect(source).not.toContain('AiDomainModelSelector domain="video-generation"');
    expect(source).toContain('AiDomainModelSelector domain="edit-agent"');
    expect(source).toContain('managed inside the Voice Generation workspace');
    expect(source).toContain('managed inside the Video Generation workspace');
    expect(source).not.toMatch(/executablePath|argv|args:/);
  });

  it('keeps provider credentials write-only through the connect dialog and safe storage IPC', async () => {
    const [source, dialog] = await Promise.all([
      readFile(SETTINGS_SOURCE_URL, 'utf8'),
      readFile(new URL('../src/renderer/src/ProviderConnectDialog.tsx', import.meta.url), 'utf8')
    ]);

    expect(source).toContain('saveProviderCredential');
    expect(source).toContain("saveProviderCredential(provider.credentialKey as LlmCredentialKey, '')");
    expect(source).not.toContain('value={providerConfig[field.keyName]');
    expect(source).not.toContain('updateProviderConfig({ [field.keyName]');
    expect(dialog).toContain('type="password"');
    expect(dialog).toContain('API key is required');
    expect(dialog).toContain('never shown again');
    expect(dialog).not.toContain('localStorage');
  });

  it('splits providers into Connected and Popular lists with a connect dialog', async () => {
    const source = await readFile(SETTINGS_SOURCE_URL, 'utf8');

    expect(source).toContain("from '../../shared/llmProviders'");
    expect(source).toContain('Connected providers');
    expect(source).toContain('Popular providers');
    expect(source).toContain('settings-list__row');
    expect(source).toContain('disconnectProvider');
    expect(source).toContain('ProviderConnectDialog');
    expect(source).toContain('+ Connect');
    expect(source).toContain('id="ollama-base-url"');
    expect(source).toContain('Media providers');
    expect(source).toContain('MEDIA_PROVIDERS.map');
    // OpenAI stays one unified entry, now advertising both login methods.
    expect(source).toContain('Connect with an API key for the public API, or sign in with ChatGPT Pro/Plus to run Codex-family models.');
    expect(source).not.toContain('OPENAI_CODEX_PROVIDER');
    expect(source).not.toContain('Sign in — not supported yet');
  });

  it('renders a Models section with search and per-model visibility switches', async () => {
    const source = await readFile(SETTINGS_SOURCE_URL, 'utf8');

    expect(source).toContain('settings-model-search');
    expect(source).toContain('filteredModelGroups(modelFilter)');
    expect(source).toContain('role="switch"');
    expect(source).toContain('aria-checked={visible}');
    expect(source).toContain('setModelVisibility(model.providerId, model.id, !visible)');
    // Visibility switches must not read as usability: every model group names
    // its provider's connection state, and the section says usage requires
    // connecting the provider.
    expect(source).toContain('settings-provider-state');
    expect(source).toContain("groupConnected ? '● Connected' : '○ Not connected'");
    expect(source).toContain('Switches control picker visibility only');
  });

  it('exposes the full catalog behind popular defaults, a Show all providers list, and render caps', async () => {
    const source = await readFile(SETTINGS_SOURCE_URL, 'utf8');

    expect(source).toContain('POPULAR_LLM_PROVIDER_IDS');
    expect(source).toContain('Show all providers');
    expect(source).toContain('Search providers');
    expect(source).toContain('MODEL_ROW_RENDER_CAP');
    expect(source).toContain('more matching models — refine your search.');
  });

  it('uses stateful section buttons with an active labeled content region', async () => {
    const source = await readFile(SETTINGS_SOURCE_URL, 'utf8');

    expect(source).toContain('activeSectionId');
    expect(source).toContain('setActiveSectionId');
    expect(source).toContain('aria-pressed={section.id === activeSectionId}');
    expect(source).toContain('aria-controls="settings-active-section"');
    expect(source).toContain('id="settings-active-section"');
    expect(source).toContain('role="region"');
    expect(source).not.toMatch(/<a key=\{section\.title\} href=/);
  });

  it('exposes a replay setup action from Data & Privacy', async () => {
    const source = await readFile(SETTINGS_SOURCE_URL, 'utf8');

    expect(source).toContain('onReplayFirstRunOnboarding');
    expect(source).toContain('Replay setup');
    expect(source).toContain('Data & Privacy');
  });
});
