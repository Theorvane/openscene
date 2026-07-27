import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

const SETTINGS_SOURCE_URL = new URL('../src/renderer/src/SettingsWorkspace.tsx', import.meta.url);

describe('Settings workspace source contract', () => {
  it('organizes settings into the requested local-first sections and reads only safe FFmpeg readiness', async () => {
    const source = await readFile(SETTINGS_SOURCE_URL, 'utf8');

    for (const heading of ['Appearance', 'Local Tools', 'Voice', 'Video', 'Edit Agent', 'Data & Privacy']) {
      expect(source).toContain(`title: '${heading}'`);
    }
    expect(source).toContain('window.videoTool.getFfmpegRuntimeStatus');
    expect(source).toContain('AiDomainModelSelector domain="voice-generation"');
    expect(source).toContain('AiDomainModelSelector domain="video-generation"');
    expect(source).toContain('AiDomainModelSelector domain="edit-agent"');
    expect(source).not.toMatch(/executablePath|argv|args:/);
  });

  it('keeps provider credentials write-only in renderer state and safe storage IPC', async () => {
    const source = await readFile(SETTINGS_SOURCE_URL, 'utf8');

    expect(source).toContain('saveProviderCredential');
    expect(source).toContain('credentialDrafts');
    expect(source).toContain('setCredentialDrafts');
    expect(source).toContain('setCredentialDrafts((current) => ({ ...current, [field.keyName]: \'\' }))');
    expect(source).not.toContain('value={providerConfig[field.keyName]');
    expect(source).not.toContain('updateProviderConfig({ [field.keyName]');
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
