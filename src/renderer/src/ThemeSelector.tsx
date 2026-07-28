import { useEffect, useRef, useState, type KeyboardEvent, type ReactElement } from 'react';
import { useTheme } from './ThemeProvider';
import { THEME_PRESETS } from './theme';
import { classNames } from './ui/classNames';

const themePresetDialogId = 'theme-preset-dialog';

export function ThemeSelector(): ReactElement {
  const { mode, preference, preset, setPreset, setPreference } = useTheme();
  const [isOpen, setIsOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  const activePreset = THEME_PRESETS.find((p) => p.id === preset);

  useEffect(() => {
    if (!isOpen) return;
    dialogRef.current?.focus();
  }, [isOpen]);

  const closeDialog = (): void => {
    setIsOpen(false);
    triggerRef.current?.focus();
  };

  const handleDialogKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    closeDialog();
  };

  return (
    <div className="theme-selector-wrapper">
      <button
        ref={triggerRef}
        className={classNames('button', 'button--ghost', 'theme-switch')}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        aria-controls={themePresetDialogId}
        aria-label={`Open theme presets. Current theme is ${mode} (${activePreset?.label ?? 'Theme preset'}).`}
        onClick={() => setIsOpen((prev) => !prev)}
      >
        <span className="theme-switch__label">Theme</span>
        <span className="theme-switch__value">{mode === 'dark' ? 'Dark' : 'Light'}</span>
      </button>

      {isOpen && (
        <div
          ref={dialogRef}
          id={themePresetDialogId}
          className="theme-preset-popover"
          role="dialog"
          aria-label="Theme Presets"
          tabIndex={-1}
          onKeyDown={handleDialogKeyDown}
        >
          <div className="theme-preset-popover__header">
            <span className="theme-preset-popover__title">Theme & Presets</span>
            <button className="theme-preset-popover__close" type="button" onClick={closeDialog}>
              Close
            </button>
          </div>

          <div className="theme-mode-segment" role="group" aria-label="Theme mode preference">
            <button
              type="button"
              className="theme-mode-segment__button"
              aria-pressed={preference === 'light'}
              onClick={() => setPreference('light')}
            >
              Light
            </button>
            <button
              type="button"
              className="theme-mode-segment__button"
              aria-pressed={preference === 'dark'}
              onClick={() => setPreference('dark')}
            >
              Dark
            </button>
            <button
              type="button"
              className="theme-mode-segment__button"
              aria-pressed={preference === 'system'}
              onClick={() => setPreference('system')}
            >
              Auto
            </button>
          </div>

          {THEME_PRESETS.map((item) => {
            const isSelected = item.id === preset;
            return (
              <button
                key={item.id}
                type="button"
                className={classNames('preset-card', isSelected ? 'preset-card--selected' : undefined)}
                aria-pressed={isSelected}
                onClick={() => {
                  setPreset(item.id);
                  closeDialog();
                }}
              >
                <span className={classNames('preset-card__swatch', `preset-card__swatch--${item.id}`)} />
                <div className="preset-card__body">
                  <div className="preset-card__meta">
                    <span className="preset-card__label">{item.label}</span>
                    <span className="preset-card__mode">{mode === 'dark' ? 'Dark' : 'Light'}</span>
                  </div>
                  <span className="preset-card__description">{item.description}</span>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
