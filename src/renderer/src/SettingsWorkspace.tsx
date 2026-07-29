import { useEffect, useState, type ReactElement, type ReactNode } from 'react';

import type { LocalFfmpegRuntimeStatus } from '../../shared/exportTypes';
import { DEFAULT_LLM_MODELS, type LlmProviderId } from '../../shared/llmModels';
import { LLM_PROVIDERS, POPULAR_LLM_PROVIDER_IDS, isProviderConnected, type LlmProviderInfo } from '../../shared/llmProviders';
import { useModelVisibility } from './ModelVisibilityContext';
import { ProviderConnectDialog } from './ProviderConnectDialog';
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
  { id: 'providers', title: 'Providers', description: 'Connected providers and popular providers to connect, opencode-style.' },
  { id: 'models', title: 'Models', description: 'Search the model catalog and choose which models appear in pickers.' },
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

type SettingsWorkspaceProps = {
  readonly onReplayFirstRunOnboarding: () => void;
};

// Cloud provider rows derive from the shared opencode-style provider registry.
const CLOUD_PROVIDERS: readonly LlmProviderInfo[] = LLM_PROVIDERS.filter(
  (provider) => provider.auth === 'api-key' && provider.credentialKey !== undefined
);

function getSettingsSection(sectionId: SettingsSectionId): SettingsSection {
  return SETTINGS_SECTIONS.find((section) => section.id === sectionId) ?? SETTINGS_SECTIONS[0];
}

const MODEL_ROW_RENDER_CAP = 250;

/**
 * Grouped catalog for the opencode-style Models section. Without a search the
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
      case 'providers': {
        const connectedProviders = CLOUD_PROVIDERS.filter((provider) => isProviderKeyStored(provider));
        const popularProviders = CLOUD_PROVIDERS.filter(
          (provider) => !isProviderKeyStored(provider) && POPULAR_LLM_PROVIDER_IDS.includes(provider.id)
        );
        const providerQuery = providerFilter.trim().toLowerCase();
        const otherProviders = CLOUD_PROVIDERS.filter(
          (provider) => !isProviderKeyStored(provider) && !POPULAR_LLM_PROVIDER_IDS.includes(provider.id)
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
                {connectedProviders.map((provider) => (
                  <div key={provider.id} className="settings-list__row">
                    <div className="settings-list__main">
                      <span className="settings-list__name">{provider.label}</span>
                      <span className="settings-tag">API key</span>
                    </div>
                    <Button variant="ghost" onClick={() => void disconnectProvider(provider)} disabled={disconnectingKey === provider.credentialKey}>
                      {disconnectingKey === provider.credentialKey ? 'Disconnecting…' : 'Disconnect'}
                    </Button>
                  </div>
                ))}
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
                        <span className="settings-list__note">{provider.description}</span>
                      </div>
                      <Button variant="default" onClick={() => setConnectTarget(provider)}>+ Connect</Button>
                    </div>
                  ))
                )}
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
              groups.map((group) => (
                <div key={group.providerId} className="settings-group">
                  <h3 className="settings-subheading">{group.providerLabel}</h3>
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
              ))
            )}
            {truncatedCount > 0 && (
              <p className="settings-list__note">{truncatedCount} more matching models — refine your search.</p>
            )}
            <StatusCard tone="neutral">Without a search the local engine and popular providers are shown; searching sweeps the full opencode/models.dev catalog. Hidden models disappear from the Edit Agent picker and the primary model list; the active selection always stays listed.</StatusCard>
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
                  ((model.providerId === 'local_ollama' || isProviderConnected(model.providerId, credentialStatus)) &&
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
