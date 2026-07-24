import { useState, type ReactElement } from 'react';
import { DEFAULT_LLM_MODELS, type LlmProviderId } from '../../shared/llmModels';
import { useLlmModel } from './LlmProviderContext';
import { useTheme } from './ThemeProvider';
import { THEME_PRESETS, type ThemePresetId } from './theme';
import { Button, Panel } from './ui';

function modelLabelsForProvider(providerId: LlmProviderId): string {
  return DEFAULT_LLM_MODELS.filter((m) => m.providerId === providerId)
    .map((m) => m.label)
    .join(' & ');
}

type ModelTestState =
  | { status: 'idle' }
  | { status: 'running' }
  | { status: 'success'; completion: string }
  | { status: 'error'; error: string };

export function SettingsWorkspace(): ReactElement {
  const { mode, preference, preset, setPreset, setPreference } = useTheme();
  const { selectedModelId, selectedModel, providerConfig, setSelectedModelId, updateProviderConfig } = useLlmModel();
  const [testState, setTestState] = useState<ModelTestState>({ status: 'idle' });

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
      } else {
        const error = response.ok ? response.value.error ?? 'Model test failed with no error detail.' : response.error.message;
        setTestState({ status: 'error', error });
      }
    } catch (err) {
      setTestState({ status: 'error', error: err instanceof Error ? err.message : 'Model test failed.' });
    }
  };

  return (
    <div
      className="settings-workspace"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '24px',
        padding: '20px 24px',
        height: '100%',
        overflowY: 'auto',
        background: 'var(--background)',
        color: 'var(--foreground)'
      }}
    >
      {/* Settings Header */}
      <header style={{ borderBottom: '1px solid var(--border)', paddingBottom: '16px' }}>
        <h1 style={{ fontSize: 'var(--text-hero)', fontWeight: 700, margin: 0, letterSpacing: '-0.02em' }}>
          Settings & Preferences
        </h1>
        <p style={{ fontSize: 'var(--text-small)', color: 'var(--muted-foreground)', margin: '4px 0 0 0' }}>
          Manage your app theme, visual presets, LLM providers, and local AI engines
        </p>
      </header>

      {/* Section 1: Appearance & Theme Settings */}
      <section style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <div>
          <h2 style={{ fontSize: 'var(--text-title)', fontWeight: 600, margin: 0 }}>Appearance & Theme</h2>
          <p style={{ fontSize: 'var(--text-caption)', color: 'var(--muted-foreground)', margin: '2px 0 0 0' }}>
            Choose between Light mode, Dark mode, or select a curated visual theme preset.
          </p>
        </div>

        {/* Theme Mode Segmented Selector */}
        <Panel style={{ padding: '16px', background: 'var(--card)', border: '1px solid var(--border)' }}>
          <label style={{ fontSize: 'var(--text-small)', fontWeight: 600, display: 'block', marginBottom: '8px' }}>
            Theme Mode
          </label>
          <div style={{ display: 'flex', gap: '8px', maxWidth: '420px' }}>
            <Button
              variant={preference === 'light' ? 'primary' : 'default'}
              onClick={() => setPreference('light')}
              style={{ flex: 1, padding: '8px 12px' }}
            >
              ☀️ Light
            </Button>
            <Button
              variant={preference === 'dark' ? 'primary' : 'default'}
              onClick={() => setPreference('dark')}
              style={{ flex: 1, padding: '8px 12px' }}
            >
              🌙 Dark
            </Button>
            <Button
              variant={preference === 'system' ? 'primary' : 'default'}
              onClick={() => setPreference('system')}
              style={{ flex: 1, padding: '8px 12px' }}
            >
              💻 System Auto
            </Button>
          </div>
          <span style={{ fontSize: 'var(--text-caption)', color: 'var(--muted-foreground)', display: 'block', marginTop: '8px' }}>
            Active mode: <strong style={{ color: 'var(--foreground)' }}>{mode.toUpperCase()}</strong> (Preference: {preference})
          </span>
        </Panel>

        {/* Visual Theme Presets Grid */}
        <Panel style={{ padding: '16px', background: 'var(--card)', border: '1px solid var(--border)' }}>
          <label style={{ fontSize: 'var(--text-small)', fontWeight: 600, display: 'block', marginBottom: '12px' }}>
            Visual Theme Presets
          </label>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
              gap: '12px'
            }}
          >
            {THEME_PRESETS.map((item) => {
              const isSelected = item.id === preset;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setPreset(item.id as ThemePresetId)}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'flex-start',
                    padding: '14px',
                    borderRadius: 'var(--radius-sm)',
                    border: isSelected ? '2px solid var(--primary)' : '1px solid var(--border)',
                    background: isSelected ? 'var(--surface-control-selected)' : 'var(--surface-inset)',
                    color: 'var(--foreground)',
                    cursor: 'pointer',
                    textAlign: 'left',
                    transition: 'all 120ms ease'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%', marginBottom: '6px' }}>
                    <span
                      style={{
                        width: '16px',
                        height: '16px',
                        borderRadius: '50%',
                        background: item.accentColor,
                        border: '1px solid rgba(255,255,255,0.3)',
                        flexShrink: 0
                      }}
                    />
                    <span style={{ fontSize: 'var(--text-body)', fontWeight: 600, flex: 1 }}>{item.label}</span>
                    <span
                      style={{
                        fontSize: '9px',
                        fontWeight: 600,
                        padding: '2px 6px',
                        borderRadius: '4px',
                        background: 'var(--surface-control)',
                        textTransform: 'uppercase',
                        fontFamily: 'var(--font-mono)'
                      }}
                    >
                      {item.mode}
                    </span>
                  </div>
                  <span style={{ fontSize: 'var(--text-micro)', color: 'var(--muted-foreground)' }}>
                    {item.description}
                  </span>
                </button>
              );
            })}
          </div>
        </Panel>
      </section>

      {/* Section 2: Opencode LLM Providers & Models */}
      <section style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <div>
          <h2 style={{ fontSize: 'var(--text-title)', fontWeight: 600, margin: 0 }}>LLM Providers & AI Models</h2>
          <p style={{ fontSize: 'var(--text-caption)', color: 'var(--muted-foreground)', margin: '2px 0 0 0' }}>
            Opencode-style model configuration for local Ollama/Qwen, OpenAI, Anthropic, Gemini, and DeepSeek.
          </p>
        </div>

        {/* Primary Model Selection Card */}
        <Panel style={{ padding: '16px', background: 'var(--card)', border: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div>
            <label style={{ fontSize: 'var(--text-small)', fontWeight: 600, display: 'block', marginBottom: '6px' }}>
              Active Primary Model
            </label>
            <select
              value={selectedModelId}
              onChange={(e) => setSelectedModelId(e.target.value)}
              style={{
                width: '100%',
                maxWidth: '420px',
                padding: '8px 12px',
                borderRadius: 'var(--radius-xs)',
                border: '1px solid var(--border)',
                background: 'var(--input)',
                color: 'var(--foreground)',
                fontSize: 'var(--text-body)',
                fontFamily: 'var(--font-mono)'
              }}
            >
              {DEFAULT_LLM_MODELS.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.label} ({model.providerLabel}) — [{model.badge}]
                </option>
              ))}
            </select>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px', borderRadius: 'var(--radius-xs)', background: 'var(--surface-inset)', border: '1px solid var(--border)' }}>
            <span style={{ fontSize: 'var(--text-subhead)' }}>🤖</span>
            <div>
              <span style={{ fontSize: 'var(--text-small)', fontWeight: 600, display: 'block' }}>
                {selectedModel.label}
              </span>
              <span style={{ fontSize: 'var(--text-caption)', color: 'var(--muted-foreground)' }}>
                {selectedModel.description}
              </span>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <Button variant="default" onClick={() => void runModelTest()} disabled={testState.status === 'running'} style={{ alignSelf: 'flex-start', padding: '8px 14px' }}>
              {testState.status === 'running' ? 'Testing…' : 'Test Selected Model'}
            </Button>
            {testState.status === 'success' && (
              <div style={{ padding: '10px', borderRadius: 'var(--radius-xs)', background: 'var(--surface-inset)', border: '1px solid var(--border)', fontSize: 'var(--text-caption)' }}>
                <strong style={{ color: 'var(--success, #2e7d32)' }}>✓ Model responded:</strong> {testState.completion}
              </div>
            )}
            {testState.status === 'error' && (
              <div style={{ padding: '10px', borderRadius: 'var(--radius-xs)', background: 'var(--surface-inset)', border: '1px solid var(--border)', fontSize: 'var(--text-caption)', color: 'var(--destructive, #c62828)' }}>
                ✗ {testState.error}
              </div>
            )}
          </div>
        </Panel>

        {/* Provider Credentials & Base URLs Grid */}
        <Panel style={{ padding: '16px', background: 'var(--card)', border: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <label style={{ fontSize: 'var(--text-small)', fontWeight: 600, display: 'block' }}>
            Provider Credentials & Endpoints
          </label>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '16px' }}>
            {/* Local Engine / Ollama */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ fontSize: 'var(--text-caption)', fontWeight: 600 }}>Local Engine (Ollama / Qwen)</label>
              <input
                type="text"
                placeholder="http://localhost:11434"
                value={providerConfig.ollamaBaseUrl || ''}
                onChange={(e) => updateProviderConfig({ ollamaBaseUrl: e.target.value })}
                style={{
                  padding: '8px 10px',
                  borderRadius: 'var(--radius-xs)',
                  border: '1px solid var(--border)',
                  background: 'var(--input)',
                  color: 'var(--foreground)',
                  fontSize: 'var(--text-caption)',
                  fontFamily: 'var(--font-mono)'
                }}
              />
              <span style={{ fontSize: 'var(--text-micro)', color: 'var(--muted-foreground)' }}>
                Default: http://localhost:11434
              </span>
            </div>

            {/* OpenAI */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ fontSize: 'var(--text-caption)', fontWeight: 600 }}>OpenAI API Key</label>
              <input
                type="password"
                placeholder="sk-proj-..."
                value={providerConfig.openaiApiKey || ''}
                onChange={(e) => updateProviderConfig({ openaiApiKey: e.target.value })}
                style={{
                  padding: '8px 10px',
                  borderRadius: 'var(--radius-xs)',
                  border: '1px solid var(--border)',
                  background: 'var(--input)',
                  color: 'var(--foreground)',
                  fontSize: 'var(--text-caption)',
                  fontFamily: 'var(--font-mono)'
                }}
              />
              <span style={{ fontSize: 'var(--text-micro)', color: 'var(--muted-foreground)' }}>
                Required for {modelLabelsForProvider('openai')}
              </span>
            </div>

            {/* Anthropic */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ fontSize: 'var(--text-caption)', fontWeight: 600 }}>Anthropic API Key</label>
              <input
                type="password"
                placeholder="sk-ant-..."
                value={providerConfig.anthropicApiKey || ''}
                onChange={(e) => updateProviderConfig({ anthropicApiKey: e.target.value })}
                style={{
                  padding: '8px 10px',
                  borderRadius: 'var(--radius-xs)',
                  border: '1px solid var(--border)',
                  background: 'var(--input)',
                  color: 'var(--foreground)',
                  fontSize: 'var(--text-caption)',
                  fontFamily: 'var(--font-mono)'
                }}
              />
              <span style={{ fontSize: 'var(--text-micro)', color: 'var(--muted-foreground)' }}>
                Required for {modelLabelsForProvider('anthropic')}
              </span>
            </div>

            {/* Google Gemini */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ fontSize: 'var(--text-caption)', fontWeight: 600 }}>Google Gemini API Key</label>
              <input
                type="password"
                placeholder="AIzaSy..."
                value={providerConfig.geminiApiKey || ''}
                onChange={(e) => updateProviderConfig({ geminiApiKey: e.target.value })}
                style={{
                  padding: '8px 10px',
                  borderRadius: 'var(--radius-xs)',
                  border: '1px solid var(--border)',
                  background: 'var(--input)',
                  color: 'var(--foreground)',
                  fontSize: 'var(--text-caption)',
                  fontFamily: 'var(--font-mono)'
                }}
              />
              <span style={{ fontSize: 'var(--text-micro)', color: 'var(--muted-foreground)' }}>
                Required for {modelLabelsForProvider('google_gemini')} & Veo Video
              </span>
            </div>

            {/* DeepSeek */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ fontSize: 'var(--text-caption)', fontWeight: 600 }}>DeepSeek API Key</label>
              <input
                type="password"
                placeholder="sk-..."
                value={providerConfig.deepseekApiKey || ''}
                onChange={(e) => updateProviderConfig({ deepseekApiKey: e.target.value })}
                style={{
                  padding: '8px 10px',
                  borderRadius: 'var(--radius-xs)',
                  border: '1px solid var(--border)',
                  background: 'var(--input)',
                  color: 'var(--foreground)',
                  fontSize: 'var(--text-caption)',
                  fontFamily: 'var(--font-mono)'
                }}
              />
              <span style={{ fontSize: 'var(--text-micro)', color: 'var(--muted-foreground)' }}>
                Required for {modelLabelsForProvider('deepseek')}
              </span>
            </div>
          </div>
        </Panel>
      </section>
    </div>
  );
}
