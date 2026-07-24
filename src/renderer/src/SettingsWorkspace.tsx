import { type ReactElement } from 'react';
import { useTheme } from './ThemeProvider';
import { THEME_PRESETS, type ThemePresetId } from './theme';
import { Button, Panel } from './ui';

export function SettingsWorkspace(): ReactElement {
  const { mode, preference, preset, setPreset, setPreference } = useTheme();

  return (
    <div
      className="settings-workspace"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '20px',
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
          Manage your app theme, visual presets, and local AI engines
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

      {/* Section 2: AI & Local Engine Configuration */}
      <section style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <div>
          <h2 style={{ fontSize: 'var(--text-title)', fontWeight: 600, margin: 0 }}>Local AI Engines & Provider Seams</h2>
          <p style={{ fontSize: 'var(--text-caption)', color: 'var(--muted-foreground)', margin: '2px 0 0 0' }}>
            Configure local model executable paths or external cloud API seams.
          </p>
        </div>

        <Panel style={{ padding: '16px', background: 'var(--card)', border: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div>
            <span style={{ fontSize: 'var(--text-small)', fontWeight: 600, display: 'block' }}>Local Video Generation Engine</span>
            <span style={{ fontSize: 'var(--text-caption)', color: 'var(--muted-foreground)' }}>
              Environment variable: <code>VIDEO_TOOL_LOCAL_VIDEO_RUNNER_PATH</code>
            </span>
          </div>
          <div>
            <span style={{ fontSize: 'var(--text-small)', fontWeight: 600, display: 'block' }}>Local Speech Synthesis Engine</span>
            <span style={{ fontSize: 'var(--text-caption)', color: 'var(--muted-foreground)' }}>
              Environment variable: <code>VIDEO_TOOL_LOCAL_TTS_RUNNER_PATH</code> / Qwen TTS model weights
            </span>
          </div>
        </Panel>
      </section>
    </div>
  );
}
