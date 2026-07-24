import { useState, type KeyboardEvent, type ReactElement } from 'react';
import { useTheme } from './ThemeProvider';
import { THEME_PRESETS, shouldToggleThemeOnSwitchKeyDown, type ThemePresetId } from './theme';
import { Button } from './ui';

export function ThemeSelector(): ReactElement {
  const { mode, preset, toggleTheme, setPreset } = useTheme();
  const [isOpen, setIsOpen] = useState(false);

  const activePreset = THEME_PRESETS.find((p) => p.id === preset) ?? THEME_PRESETS[0]!;

  const handleSwitchKeyDown = (event: KeyboardEvent<HTMLButtonElement>): void => {
    if (!shouldToggleThemeOnSwitchKeyDown(event.key)) return;
    event.preventDefault();
    toggleTheme();
  };

  return (
    <div className="theme-selector-wrapper" style={{ position: 'relative' }}>
      <Button
        className="theme-switch"
        role="switch"
        variant="ghost"
        aria-checked={mode === 'dark'}
        aria-label={`Theme is ${mode} (${activePreset.label}). Click to open theme presets.`}
        onClick={() => setIsOpen((prev) => !prev)}
        onKeyDown={handleSwitchKeyDown}
      >
        <span className="theme-switch__label">Theme</span>
        <span className="theme-switch__value">{activePreset.label}</span>
      </Button>

      {isOpen && (
        <div
          className="theme-preset-popover"
          role="dialog"
          aria-label="Theme Presets"
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            right: 0,
            zIndex: 1000,
            width: '260px',
            padding: '10px',
            background: 'var(--card)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-md)',
            boxShadow: 'var(--shadow-panel)',
            display: 'flex',
            flexDirection: 'column',
            gap: '6px'
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
            <span style={{ fontSize: 'var(--text-caption)', fontWeight: 600, color: 'var(--muted-foreground)' }}>Visual Presets</span>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              style={{ background: 'none', border: 'none', color: 'var(--muted-foreground)', cursor: 'pointer', fontSize: '12px' }}
            >
              ✕
            </button>
          </div>

          {THEME_PRESETS.map((item) => {
            const isSelected = item.id === preset;
            return (
              <button
                key={item.id}
                type="button"
                className={`preset-card ${isSelected ? 'preset-card--selected' : ''}`}
                onClick={() => {
                  setPreset(item.id as ThemePresetId);
                  setIsOpen(false);
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  padding: '8px 10px',
                  border: isSelected ? '1px solid var(--primary)' : '1px solid var(--border)',
                  borderRadius: 'var(--radius-xs)',
                  background: isSelected ? 'var(--surface-control-selected)' : 'var(--surface-inset)',
                  color: 'var(--foreground)',
                  cursor: 'pointer',
                  textAlign: 'left',
                  transition: 'all 120ms ease'
                }}
              >
                <span
                  style={{
                    width: '14px',
                    height: '14px',
                    borderRadius: '50%',
                    background: item.accentColor,
                    border: '1px solid rgba(255,255,255,0.2)',
                    flexShrink: 0
                  }}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span style={{ fontSize: 'var(--text-small)', fontWeight: 600 }}>{item.label}</span>
                    <span style={{ fontSize: '8px', opacity: 0.7, textTransform: 'uppercase', fontFamily: 'var(--font-mono)' }}>
                      {item.mode}
                    </span>
                  </div>
                  <span style={{ fontSize: 'var(--text-micro)', color: 'var(--muted-foreground)', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {item.description}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
