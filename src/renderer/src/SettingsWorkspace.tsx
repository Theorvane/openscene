import { useEffect, useState, type ReactElement, type ReactNode } from 'react';

import type { LocalFfmpegRuntimeStatus } from '../../shared/exportTypes';
import { DEFAULT_LLM_MODELS, type LlmProviderId } from '../../shared/llmModels';
import { LLM_PROVIDERS } from '../../shared/llmProviders';
import { AiDomainModelSelector } from './AiDomainModelSelector';
import { TimelineShortcutMap } from './editor/TimelineEditorLayoutControls';
import { useEditorShortcutPreference } from './editor/useEditorShortcutPreference';
import { useLlmModel, type LlmCredentialKey } from './LlmProviderContext';
import { useTheme } from './ThemeProvider';
import { THEME_PRESETS } from './theme';
import { Button, MetadataList, Panel, PanelHeading, StatusCard } from './ui';
import { classNames } from './ui/classNames';

const SETTINGS_SECTIONS = [
  { id: 'appearance', title: 'Appearance', description: 'Theme mode and command desk presets.' },
  { id: 'local-tools', title: 'Local Tools', description: 'Local runtime readiness for desktop capture, narration, and final export.' },
  { id: 'voice', title: 'Voice', description: 'Voice model preference and consent-based local narration boundaries.' },
  { id: 'video', title: 'Video', description: 'Video model preference and local result import boundaries.' },
  { id: 'providers', title: 'Providers', description: 'Connect model providers: the local engine plus cloud APIs with safe-storage keys.' },
  { id: 'edit-agent', title: 'Edit Agent', description: 'Model preference for the persistent right-side agent.' },
  { id: 'shortcuts', title: 'Shortcuts', description: 'Timeline editor keyboard shortcut remapping.' },
  { id: 'data-privacy', title: 'Data & Privacy', description: 'Local storage, provider authorization, and deletion expectations.' }
] as const;

type SettingsSection = (typeof SETTINGS_SECTIONS)[number];
type SettingsSectionId = SettingsSection['id'];

type ModelTestState =
  | { readonly status: 'idle' }
  | { readonly status: 'running' }
  | { readonly status: 'success'; readonly completion: string }
  | { readonly status: 'error'; readonly error: string };

type FfmpegStatusState =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly value: LocalFfmpegRuntimeStatus }
  | { readonly status: 'error'; readonly error: string };

type CredentialField = {
  readonly providerId: LlmProviderId;
  readonly keyName: LlmCredentialKey;
  readonly label: string;
  readonly placeholder: string;
};

type CredentialDrafts = Record<LlmCredentialKey, string>;
type CredentialSaveState = Record<LlmCredentialKey, 'idle' | 'saving' | 'saved' | 'error'>;

type SettingsWorkspaceProps = {
  readonly onReplayFirstRunOnboarding: () => void;
};

// Cloud provider rows derive from the shared opencode-style provider registry.
const CREDENTIAL_FIELDS: readonly CredentialField[] = LLM_PROVIDERS
  .filter((provider) => provider.auth === 'api-key' && provider.credentialKey !== undefined)
  .map((provider) => ({
    providerId: provider.id,
    keyName: provider.credentialKey as LlmCredentialKey,
    label: provider.label,
    placeholder: provider.keyPlaceholder ?? ''
  }));

const EMPTY_CREDENTIAL_DRAFTS: CredentialDrafts = {
  openaiApiKey: '',
  anthropicApiKey: '',
  geminiApiKey: '',
  deepseekApiKey: '',
  elevenlabsApiKey: ''
};

const IDLE_CREDENTIAL_SAVE_STATE: CredentialSaveState = {
  openaiApiKey: 'idle',
  anthropicApiKey: 'idle',
  geminiApiKey: 'idle',
  deepseekApiKey: 'idle',
  elevenlabsApiKey: 'idle'
};

function getSettingsSection(sectionId: SettingsSectionId): SettingsSection {
  return SETTINGS_SECTIONS.find((section) => section.id === sectionId) ?? SETTINGS_SECTIONS[0];
}

function modelLabelsForProvider(providerId: LlmProviderId): string {
  return DEFAULT_LLM_MODELS.filter((model) => model.providerId === providerId)
    .map((model) => model.label)
    .join(' & ');
}

function ffmpegStatusText(state: FfmpegStatusState): { readonly tone: 'neutral' | 'success' | 'warning' | 'danger'; readonly text: string } {
  switch (state.status) {
    case 'loading':
      return { tone: 'warning', text: 'Checking local FFmpeg readiness.' };
    case 'error':
      return { tone: 'danger', text: state.error };
    case 'ready':
      switch (state.value.kind) {
        case 'configured':
          return { tone: 'success', text: 'Configured FFmpeg runtime is available for local MP4 export.' };
        case 'system':
          return { tone: 'success', text: 'System FFmpeg runtime is available for local MP4 export.' };
        case 'unavailable':
          return { tone: 'danger', text: state.value.reason };
      }
  }
}

export function SettingsWorkspace({ onReplayFirstRunOnboarding }: SettingsWorkspaceProps): ReactElement {
  const { mode, preference, preset, setPreset, setPreference } = useTheme();
  const { credentialStatus, providerConfig, saveProviderCredential, selectedModel, selectedModelId, setSelectedModelId, updateProviderConfig } = useLlmModel();
  const [activeSectionId, setActiveSectionId] = useState<SettingsSectionId>('appearance');
  const [credentialDrafts, setCredentialDrafts] = useState<CredentialDrafts>(EMPTY_CREDENTIAL_DRAFTS);
  const [credentialSaveState, setCredentialSaveState] = useState<CredentialSaveState>(IDLE_CREDENTIAL_SAVE_STATE);
  const [testState, setTestState] = useState<ModelTestState>({ status: 'idle' });
  const [ffmpegState, setFfmpegState] = useState<FfmpegStatusState>({ status: 'loading' });
  const { shortcutPreferences, updateShortcutPreferences } = useEditorShortcutPreference();
  const activeSection = getSettingsSection(activeSectionId);
  const ffmpegView = ffmpegStatusText(ffmpegState);

  useEffect(() => {
    let mounted = true;
    window.videoTool.getFfmpegRuntimeStatus()
      .then((response) => {
        if (!mounted) return;
        setFfmpegState(response.ok ? { status: 'ready', value: response.value } : { status: 'error', error: response.error.message });
      })
      .catch((error: unknown) => {
        if (!mounted) return;
        setFfmpegState({ status: 'error', error: error instanceof Error ? error.message : 'FFmpeg readiness could not be checked.' });
      });
    return () => {
      mounted = false;
    };
  }, []);

  const runModelTest = async (): Promise<void> => {
    setTestState({ status: 'running' });
    try {
      const response = await window.videoTool.executeLlmPrompt({
        modelId: selectedModelId,
        prompt: 'Reply with a short one-sentence greeting to confirm you are online.',
        ...(providerConfig.ollamaBaseUrl ? { ollamaBaseUrl: providerConfig.ollamaBaseUrl } : {})
      });
      if (response.ok && response.value.ok && response.value.completion) {
        setTestState({ status: 'success', completion: response.value.completion });
        return;
      }
      setTestState({ status: 'error', error: response.ok ? response.value.error ?? 'Model test failed with no error detail.' : response.error.message });
    } catch (error: unknown) {
      setTestState({ status: 'error', error: error instanceof Error ? error.message : 'Model test failed.' });
    }
  };

  const saveCredentialDraft = async (field: CredentialField): Promise<void> => {
    setCredentialSaveState((current) => ({ ...current, [field.keyName]: 'saving' }));
    const saved = await saveProviderCredential(field.keyName, credentialDrafts[field.keyName]);
    setCredentialSaveState((current) => ({ ...current, [field.keyName]: saved ? 'saved' : 'error' }));
    if (saved) {
      setCredentialDrafts((current) => ({ ...current, [field.keyName]: '' }));
    }
  };

  const disconnectProvider = async (field: CredentialField): Promise<void> => {
    setCredentialSaveState((current) => ({ ...current, [field.keyName]: 'saving' }));
    const cleared = await saveProviderCredential(field.keyName, '');
    setCredentialSaveState((current) => ({ ...current, [field.keyName]: cleared ? 'idle' : 'error' }));
  };

  const renderActiveSection = (): ReactNode => {
    switch (activeSectionId) {
      case 'appearance':
        return (
          <>
            <div className="settings-control-row" role="group" aria-label="Theme mode">
              <Button variant={preference === 'light' ? 'primary' : 'default'} onClick={() => setPreference('light')}>Light</Button>
              <Button variant={preference === 'dark' ? 'primary' : 'default'} onClick={() => setPreference('dark')}>Dark</Button>
              <Button variant={preference === 'system' ? 'primary' : 'default'} onClick={() => setPreference('system')}>System</Button>
            </div>
            <MetadataList items={[{ term: 'Active mode', description: mode }, { term: 'Preference', description: preference }]} />
            <div className="settings-preset-grid">
              {THEME_PRESETS.map((item) => (
                <button key={item.id} className="settings-preset-card" type="button" aria-pressed={item.id === preset} onClick={() => setPreset(item.id)}>
                  <span className={classNames('settings-preset-card__swatch', 'preset-swatch', `preset-swatch--${item.id}`)} />
                  <strong>{item.label}</strong>
                  <small>{item.description}</small>
                </button>
              ))}
            </div>
          </>
        );
      case 'local-tools':
        return (
          <>
            <StatusCard tone={ffmpegView.tone}>{ffmpegView.text}</StatusCard>
            <MetadataList items={[{ term: 'Screen permission', description: 'Checked by the recorder when capture starts.' }, { term: 'Local Qwen', description: 'User-configured runtime only; no model download is bundled.' }]} />
          </>
        );
      case 'voice':
        return (
          <>
            <AiDomainModelSelector domain="voice-generation" label="Voice generation model" description="Choose the configured model used by the Voice Generation workspace." />
            <StatusCard tone="neutral">Voice samples must be user-owned or authorized, stored locally, and deletable from local app storage.</StatusCard>
          </>
        );
      case 'video':
        return (
          <>
            <AiDomainModelSelector domain="video-generation" label="Video generation model" description="Choose the configured model used by the Video Generation workspace." />
            <StatusCard tone="warning">Provider seams are selectable preferences only; unsupported cloud adapters are not silently called.</StatusCard>
          </>
        );
      case 'providers':
        return (
          <>
            <div className="settings-provider-list">
              <div className="settings-provider-row">
                <div className="settings-provider-row__head">
                  <strong className="settings-provider-row__name">Ollama</strong>
                  <span className="settings-provider-row__status settings-provider-row__status--on">● Local</span>
                </div>
                <p className="settings-provider-row__description">Local engine over HTTP. No account or key; models run on this machine.</p>
                <label className="field-label" htmlFor="ollama-base-url">
                  Endpoint
                  <input id="ollama-base-url" type="text" value={providerConfig.ollamaBaseUrl ?? ''} placeholder="http://localhost:11434" onChange={(event) => updateProviderConfig({ ollamaBaseUrl: event.target.value })} />
                </label>
              </div>
              {CREDENTIAL_FIELDS.map((field) => {
                const connected = credentialStatus[field.keyName] === true;
                return (
                  <div key={field.keyName} className="settings-provider-row">
                    <div className="settings-provider-row__head">
                      <strong className="settings-provider-row__name">{field.label}</strong>
                      <span className={`settings-provider-row__status${connected ? ' settings-provider-row__status--on' : ''}`}>
                        {connected ? '● Connected' : '○ Not connected'}
                      </span>
                    </div>
                    <p className="settings-provider-row__description">Unlocks {modelLabelsForProvider(field.providerId)}.</p>
                    <div className="settings-provider-row__controls">
                      <label className="field-label" htmlFor={`credential-${field.keyName}`}>
                        API key
                        <input id={`credential-${field.keyName}`} type="password" placeholder={field.placeholder} value={credentialDrafts[field.keyName]} onChange={(event) => setCredentialDrafts((current) => ({ ...current, [field.keyName]: event.target.value }))} />
                      </label>
                      <Button variant="primary" onClick={() => void saveCredentialDraft(field)} disabled={credentialSaveState[field.keyName] === 'saving' || credentialDrafts[field.keyName].trim().length === 0}>
                        {credentialSaveState[field.keyName] === 'saving' ? 'Working...' : connected ? 'Replace key' : 'Connect'}
                      </Button>
                      {connected && (
                        <Button variant="default" onClick={() => void disconnectProvider(field)} disabled={credentialSaveState[field.keyName] === 'saving'}>Disconnect</Button>
                      )}
                    </div>
                    {credentialSaveState[field.keyName] === 'saved' && <span role="status">Credential saved to main-process safe storage.</span>}
                    {credentialSaveState[field.keyName] === 'error' && <span role="status">Credential could not be saved.</span>}
                  </div>
                );
              })}
            </div>
            <StatusCard tone="neutral">API keys live in main-process safe storage, are write-only from this screen, and are never rendered back.</StatusCard>
          </>
        );
      case 'edit-agent':
        return (
          <>
            <AiDomainModelSelector domain="edit-agent" label="Edit Agent model" description="Choose the model preference for the persistent right-side Edit Agent panel." />
            <label className="field-label" htmlFor="primary-model">Primary LLM model</label>
            <select id="primary-model" value={selectedModelId} onChange={(event) => setSelectedModelId(event.target.value)}>
              {DEFAULT_LLM_MODELS.map((model) => <option key={model.id} value={model.id}>{model.label} ({model.providerLabel}) - [{model.badge}]</option>)}
            </select>
            <StatusCard tone="neutral"><strong>{selectedModel.label}</strong>: {selectedModel.description}</StatusCard>
            <Button variant="default" onClick={() => void runModelTest()} disabled={testState.status === 'running'}>{testState.status === 'running' ? 'Testing...' : 'Test selected model'}</Button>
            {testState.status === 'success' && <StatusCard tone="success">Model responded: {testState.completion}</StatusCard>}
            {testState.status === 'error' && <StatusCard tone="danger">{testState.error}</StatusCard>}
          </>
        );
      case 'shortcuts':
        return (
          <>
            <TimelineShortcutMap shortcutPreferences={shortcutPreferences} onShortcutPreferencesChange={updateShortcutPreferences} />
            <StatusCard tone="neutral">Shortcut changes persist locally and apply immediately inside the Editing workspace.</StatusCard>
          </>
        );
      case 'data-privacy':
        return (
          <>
            <MetadataList items={[{ term: 'Projects', description: 'Stored under local Electron user data.' }, { term: 'Exports', description: 'Opened and revealed through main-process actions only.' }, { term: 'Provider secrets', description: 'Sent to main-process safe storage instead of plain localStorage.' }]} />
            <StatusCard tone="success">No account system, analytics, crash reporting, cloud upload, or hidden provider network work is implemented.</StatusCard>
            <Button variant="default" onClick={onReplayFirstRunOnboarding}>Replay setup</Button>
          </>
        );
    }
  };

  return (
    <div className="settings-workspace">
      <header className="settings-workspace__header">
        <p className="section-kicker">Settings</p>
        <h1 id="settings-page-title">Local workspace preferences.</h1>
        <p>Configure appearance, local runtime readiness, model preferences, and privacy boundaries without exposing paths or secrets to the renderer.</p>
      </header>

      <div className="settings-workspace__grid">
        {SETTINGS_SECTIONS.map((section) => (
          <button key={section.id} type="button" aria-controls="settings-active-section" aria-pressed={section.id === activeSectionId} onClick={() => setActiveSectionId(section.id)}>
            <strong>{section.title}</strong>
            <span>{section.description}</span>
          </button>
        ))}
      </div>

      <Panel id="settings-active-section" className="settings-section" role="region" aria-labelledby={`settings-section-${activeSection.id}`}>
        <PanelHeading><div><h2 id={`settings-section-${activeSection.id}`}>{activeSection.title}</h2><p>{activeSection.description}</p></div></PanelHeading>
        {renderActiveSection()}
      </Panel>
    </div>
  );
}
