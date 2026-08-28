import { useEffect, useState, type ReactElement, type ReactNode } from 'react';

import type { LocalFfmpegRuntimeStatus } from '../../shared/exportTypes';
import { DEFAULT_LLM_MODELS, type LlmProviderId } from '../../shared/llmModels';
import { LLM_PROVIDERS, MEDIA_PROVIDERS, POPULAR_LLM_PROVIDER_IDS, isProviderConnected, type LlmProviderInfo } from '../../shared/llmProviders';
import { isOpenAiCodexModelKey, resolveOpenAiAuthMode } from '../../shared/openAiAuth';
import { useChatGptAuth } from './ChatGptAuthContext';
import { useModelVisibility } from './ModelVisibilityContext';
import { ProviderConnectDialog, type ProviderOAuthMethod } from './ProviderConnectDialog';
import { SpendSettings } from './SpendSettings';
import { UpdatesSettings } from './UpdatesSettings';
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
  { id: 'voice', title: 'Voice', description: 'Cloud voice generation boundaries and where its models are managed.' },
  { id: 'video', title: 'Video', description: 'Video model preference and local result import boundaries.' },
  { id: 'providers', title: 'Providers', description: 'Connected providers, and popular providers to connect.' },
  { id: 'models', title: 'Models', description: 'Search the model catalog and choose which models appear in pickers.' },
  { id: 'edit-agent', title: 'Edit Agent', description: 'Model preference for the persistent right-side agent.' },
  { id: 'shortcuts', title: 'Shortcuts', description: 'Timeline editor keyboard shortcut remapping.' },
  { id: 'spending', title: 'Spending', description: 'What generation has cost this month, and the ceiling on it.' },
  { id: 'updates', title: 'Updates', description: 'Installed version and how new releases reach this build.' },
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

type SettingsWorkspaceProps = {
  readonly onReplayFirstRunOnboarding: () => void;
};

// Cloud LLM provider rows derive from the shared provider
// registry; media-generation providers get their own subsection.
const CLOUD_PROVIDERS: readonly LlmProviderInfo[] = LLM_PROVIDERS.filter(
  (provider) => provider.auth === 'api-key' && provider.credentialKey !== undefined && provider.adapter !== 'media'
);

function getSettingsSection(sectionId: SettingsSectionId): SettingsSection {
  return SETTINGS_SECTIONS.find((section) => section.id === sectionId) ?? SETTINGS_SECTIONS[0];
}

const MODEL_ROW_RENDER_CAP = 250;

/**
 * Grouped catalog for the Models section. Without a search the
 * full ~4300-model catalog would swamp the DOM, so the default view shows the
 * local engine plus the popular providers; searching sweeps everything, with
 * rendered rows capped and the overflow reported.
 */
function filteredModelGroups(filter: string): {
  readonly groups: readonly { readonly providerId: LlmProviderId; readonly providerLabel: string; readonly models: readonly (typeof DEFAULT_LLM_MODELS)[number][] }[];
  readonly truncatedCount: number;
} {
  const query = filter.trim().toLowerCase();
  const matches = DEFAULT_LLM_MODELS.filter((model) =>
    query.length === 0
      ? model.providerId === 'local_ollama' || POPULAR_LLM_PROVIDER_IDS.includes(model.providerId)
      : model.label.toLowerCase().includes(query) ||
        model.providerLabel.toLowerCase().includes(query) ||
        model.id.toLowerCase().includes(query)
  );
  const visible = matches.slice(0, MODEL_ROW_RENDER_CAP);
  const groups = LLM_PROVIDERS
    .map((provider) => ({
      providerId: provider.id,
      providerLabel: provider.label,
      models: visible.filter((model) => model.providerId === provider.id)
    }))
    .filter((group) => group.models.length > 0);
  return { groups, truncatedCount: matches.length - visible.length };
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
  const { isModelVisible, setModelVisibility } = useModelVisibility();
  const [connectTarget, setConnectTarget] = useState<LlmProviderInfo | null>(null);
  const chatGptAuth = useChatGptAuth();
  const [showAllProviders, setShowAllProviders] = useState(false);
  const [providerFilter, setProviderFilter] = useState('');
  const [disconnectingKey, setDisconnectingKey] = useState<string | null>(null);
  const [modelFilter, setModelFilter] = useState('');
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
        openAiAuthMode: resolveOpenAiAuthMode(selectedModelId, chatGptAuth.isConnected),
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

  const disconnectProvider = async (provider: LlmProviderInfo): Promise<void> => {
    if (provider.credentialKey === undefined) return;
    setDisconnectingKey(provider.credentialKey);
    await saveProviderCredential(provider.credentialKey as LlmCredentialKey, '');
    setDisconnectingKey(null);
  };

  const isProviderKeyStored = (provider: LlmProviderInfo): boolean =>
    provider.credentialKey !== undefined && credentialStatus[provider.credentialKey] === true;

  /** OpenAI is one unified provider with two methods: API key and ChatGPT sign-in. */
  const isProviderLinked = (provider: LlmProviderInfo): boolean =>
    isProviderKeyStored(provider) || (provider.id === 'openai' && chatGptAuth.isConnected);

  const chatGptSignInMethod: ProviderOAuthMethod = {
    label: 'ChatGPT Pro/Plus',
    description: 'Sign in with your ChatGPT account to run Codex-family models.',
    isConnecting: chatGptAuth.state === 'connecting',
    ...(chatGptAuth.error === undefined ? {} : { error: chatGptAuth.error }),
    onSignIn: chatGptAuth.connect,
    onCancel: chatGptAuth.cancel
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
            <MetadataList items={[{ term: 'Screen permission', description: 'Checked by the recorder when capture starts.' }, { term: 'Ollama', description: 'The only local engine; it serves the Edit Agent and needs no bundled download.' }]} />
          </>
        );
      case 'voice':
        return (
          <>
            <StatusCard tone="neutral">Voice generation models are managed inside the Voice Generation workspace; connect ElevenLabs or another media provider under Providers to unlock cloud synthesis.</StatusCard>
            <StatusCard tone="neutral">Scripts are sent to the connected voice provider only when you generate; generated audio is written to local app storage.</StatusCard>
          </>
        );
      case 'video':
        return (
          <>
            <StatusCard tone="neutral">Video generation models are managed inside the Video Generation workspace; connect Google Gemini (Veo) or OpenAI (Sora) under Providers to unlock cloud synthesis.</StatusCard>
            <StatusCard tone="warning">Provider seams are selectable preferences only; unsupported cloud adapters are not silently called.</StatusCard>
          </>
        );
      case 'providers': {
        const connectedProviders = CLOUD_PROVIDERS.filter((provider) => isProviderLinked(provider));
        const popularProviders = CLOUD_PROVIDERS.filter(
          (provider) => !isProviderLinked(provider) && POPULAR_LLM_PROVIDER_IDS.includes(provider.id)
        );
        const providerQuery = providerFilter.trim().toLowerCase();
        const otherProviders = CLOUD_PROVIDERS.filter(
          (provider) => !isProviderLinked(provider) && !POPULAR_LLM_PROVIDER_IDS.includes(provider.id)
        );
        const matchedOtherProviders = otherProviders.filter(
          (provider) => providerQuery.length === 0 || provider.label.toLowerCase().includes(providerQuery) || provider.id.toLowerCase().includes(providerQuery)
        );
        const visibleOtherProviders = matchedOtherProviders.slice(0, 40);
        return (
          <>
            <div className="settings-group">
              <h3 className="settings-subheading">Connected providers</h3>
              <div className="settings-list">
                <div className="settings-list__row">
                  <div className="settings-list__main">
                    <span className="settings-list__name">Ollama</span>
                    <span className="settings-tag">Local</span>
                  </div>
                  <label className="field-label settings-list__inline-field" htmlFor="ollama-base-url">
                    Endpoint
                    <input id="ollama-base-url" type="text" value={providerConfig.ollamaBaseUrl ?? ''} placeholder="http://localhost:11434" onChange={(event) => updateProviderConfig({ ollamaBaseUrl: event.target.value })} />
                  </label>
                </div>
                {connectedProviders.map((provider) => {
                  const keyStored = isProviderKeyStored(provider);
                  const chatGptLinked = provider.id === 'openai' && chatGptAuth.isConnected;
                  return (
                    <div key={provider.id} className="settings-list__row">
                      <div className="settings-list__main">
                        <span className="settings-list__name">{provider.label}</span>
                        {keyStored && <span className="settings-tag">API key</span>}
                        {chatGptLinked && <span className="settings-tag">ChatGPT</span>}
                      </div>
                      <div className="settings-list__actions">
                        {provider.id === 'openai' && !chatGptLinked && (
                          <Button variant="default" onClick={() => setConnectTarget(provider)}>+ Add ChatGPT</Button>
                        )}
                        {chatGptLinked && (
                          <Button variant="ghost" onClick={() => void chatGptAuth.disconnect()}>Sign out of ChatGPT</Button>
                        )}
                        {keyStored && (
                          <Button variant="ghost" onClick={() => void disconnectProvider(provider)} disabled={disconnectingKey === provider.credentialKey}>
                            {disconnectingKey === provider.credentialKey ? 'Disconnecting…' : 'Disconnect key'}
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="settings-group">
              <h3 className="settings-subheading">Popular providers</h3>
              <div className="settings-list">
                {popularProviders.length === 0 ? (
                  <div className="settings-list__empty">All providers are connected.</div>
                ) : (
                  popularProviders.map((provider) => (
                    <div key={provider.id} className="settings-list__row">
                      <div className="settings-list__main settings-list__main--stacked">
                        <span className="settings-list__name">{provider.label}</span>
                        <span className="settings-list__note">
                          {provider.id === 'openai'
                            ? 'Connect with an API key for the public API, or sign in with ChatGPT Pro/Plus to run Codex-family models.'
                            : provider.description}
                        </span>
                      </div>
                      <Button variant="default" onClick={() => setConnectTarget(provider)}>+ Connect</Button>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="settings-group">
              <h3 className="settings-subheading">Media providers</h3>
              <div className="settings-list">
                {MEDIA_PROVIDERS.map((provider) => {
                  const connected = isProviderKeyStored(provider);
                  return (
                    <div key={provider.id} className="settings-list__row">
                      <div className="settings-list__main settings-list__main--stacked">
                        <span className="settings-list__name">{provider.label}</span>
                        <span className="settings-list__note">{provider.description}</span>
                      </div>
                      {connected ? (
                        <Button variant="ghost" onClick={() => void disconnectProvider(provider)} disabled={disconnectingKey === provider.credentialKey}>
                          {disconnectingKey === provider.credentialKey ? 'Disconnecting…' : 'Disconnect'}
                        </Button>
                      ) : (
                        <Button variant="default" onClick={() => setConnectTarget(provider)}>+ Connect</Button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {!showAllProviders ? (
              <Button variant="ghost" className="settings-show-all" onClick={() => setShowAllProviders(true)}>
                Show all providers ({otherProviders.length} more)
              </Button>
            ) : (
              <div className="settings-group">
                <h3 className="settings-subheading">All providers</h3>
                <div className="settings-model-search">
                  <input
                    type="search"
                    aria-label="Search providers"
                    placeholder="Search providers"
                    value={providerFilter}
                    onChange={(event) => setProviderFilter(event.target.value)}
                    spellCheck={false}
                  />
                  {providerFilter.length > 0 && (
                    <Button variant="ghost" onClick={() => setProviderFilter('')} aria-label="Clear provider search">✕</Button>
                  )}
                </div>
                <div className="settings-list">
                  {visibleOtherProviders.length === 0 ? (
                    <div className="settings-list__empty">No providers found{providerQuery.length > 0 ? ` for “${providerFilter.trim()}”` : ''}.</div>
                  ) : (
                    visibleOtherProviders.map((provider) => (
                      <div key={provider.id} className="settings-list__row">
                        <div className="settings-list__main settings-list__main--stacked">
                          <span className="settings-list__name">{provider.label}</span>
                          <span className="settings-list__note">{provider.description}</span>
                        </div>
                        <Button variant="default" onClick={() => setConnectTarget(provider)}>+ Connect</Button>
                      </div>
                    ))
                  )}
                </div>
                {matchedOtherProviders.length > visibleOtherProviders.length && (
                  <p className="settings-list__note">{matchedOtherProviders.length - visibleOtherProviders.length} more providers — refine your search.</p>
                )}
              </div>
            )}

            <StatusCard tone="neutral">API keys live in main-process safe storage, are write-only from this screen, and are never rendered back.</StatusCard>
            {connectTarget !== null && connectTarget.credentialKey !== undefined && (
              <ProviderConnectDialog
                provider={connectTarget}
                onConnect={(apiKey) => saveProviderCredential(connectTarget.credentialKey as LlmCredentialKey, apiKey)}
                onClose={() => setConnectTarget(null)}
                {...(connectTarget.id === 'openai' ? { oauthMethod: chatGptSignInMethod } : {})}
              />
            )}
          </>
        );
      }
      case 'models': {
        const { groups, truncatedCount } = filteredModelGroups(modelFilter);
        return (
          <>
            <div className="settings-model-search">
              <input
                type="search"
                aria-label="Search models"
                placeholder="Search models"
                value={modelFilter}
                onChange={(event) => setModelFilter(event.target.value)}
                spellCheck={false}
              />
              {modelFilter.length > 0 && (
                <Button variant="ghost" onClick={() => setModelFilter('')} aria-label="Clear model search">✕</Button>
              )}
            </div>
            {groups.length === 0 ? (
              <div className="settings-list__empty">
                No models found{modelFilter.trim().length > 0 ? ` for “${modelFilter.trim()}”` : ''}.
              </div>
            ) : (
              groups.map((group) => {
                const groupConnected = group.providerId === 'local_ollama' || isProviderConnected(group.providerId, credentialStatus);
                return (
                <div key={group.providerId} className="settings-group">
                  <div className="settings-group__heading-row">
                    <h3 className="settings-subheading">{group.providerLabel}</h3>
                    <span className={`settings-provider-state${groupConnected ? ' settings-provider-state--on' : ''}`}>
                      {group.providerId === 'local_ollama' ? '● Local' : groupConnected ? '● Connected' : '○ Not connected'}
                    </span>
                  </div>
                  <div className="settings-list">
                    {group.models.map((model) => {
                      const visible = isModelVisible(model.providerId, model.id);
                      return (
                        <div key={model.id} className="settings-list__row">
                          <div className="settings-list__main settings-list__main--stacked">
                            <span className="settings-list__name">{model.label}</span>
                            <span className="settings-list__note">{model.contextWindow !== undefined ? `${model.contextWindow} context` : model.description}</span>
                          </div>
                          <button
                            type="button"
                            role="switch"
                            aria-checked={visible}
                            aria-label={`Show ${model.label} in model pickers`}
                            className={`settings-switch${visible ? ' settings-switch--on' : ''}`}
                            onClick={() => setModelVisibility(model.providerId, model.id, !visible)}
                          >
                            <span className="settings-switch__thumb" aria-hidden="true" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
                );
              })
            )}
            {truncatedCount > 0 && (
              <p className="settings-list__note">{truncatedCount} more matching models — refine your search.</p>
            )}
            <StatusCard tone="neutral">Switches control picker visibility only — a model becomes usable once its provider is connected in Settings → Providers. Without a search the local engine and popular providers are shown; searching sweeps the full models.dev catalog. The active selection always stays listed.</StatusCard>
          </>
        );
      }
      case 'edit-agent':
        return (
          <>
            <AiDomainModelSelector domain="edit-agent" label="Edit Agent model" description="Choose the model preference for the persistent right-side Edit Agent panel." />
            <label className="field-label" htmlFor="primary-model">Primary LLM model</label>
            <select id="primary-model" value={selectedModelId} onChange={(event) => setSelectedModelId(event.target.value)}>
              {DEFAULT_LLM_MODELS
                .filter((model) =>
                  model.id === selectedModelId ||
                  ((model.providerId === 'local_ollama' ||
                    isProviderConnected(model.providerId, credentialStatus) ||
                    (chatGptAuth.isConnected && isOpenAiCodexModelKey(model.id))) &&
                    isModelVisible(model.providerId, model.id)))
                .map((model) => <option key={model.id} value={model.id}>{model.label} ({model.providerLabel}) - [{model.badge}]</option>)}
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
      case 'spending':
        return <SpendSettings />;
      case 'updates':
        return <UpdatesSettings />;
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
