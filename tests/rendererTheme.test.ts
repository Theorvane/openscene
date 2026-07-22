import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { parseThemePreference, resolveThemeMode, shouldToggleThemeOnSwitchKeyDown, toggleThemeMode } from '../src/renderer/src/theme';

const rendererStyles = readFileSync(new URL('../src/renderer/src/styles.css', import.meta.url), 'utf8');
const minimumNormalTextContrast = 4.5;
const minimumExpressiveColorChroma = 24;
const minimumDistinctSemanticColorDistance = 64;
const brightEditorContractTokens = [
  '--editor-canvas: #f8faff;',
  '--editor-navy: #172554;',
  '--editor-lilac-grid: rgba(168, 162, 255, 0.18);',
  '--editor-glass: rgba(255, 255, 255, 0.76);',
  '--editor-glass-border: rgba(168, 162, 255, 0.34);',
  '--editor-gradient-accent: linear-gradient(135deg, #2563eb 0%, #7c3aed 48%, #ec4899 100%);'
] as const;

const brightEditorSurfaceSelectors = [
  '.app-shell',
  '.workspace-nav',
  '.editor-program-region',
  '.project-rail',
  '.asset-bin',
  '.timeline-panel',
  '.inspector-panel',
  '.editor-preview-frame',
  '.timeline-track__lane',
  '.timeline-clip'
] as const;

const themeModes = ['light', 'dark'] as const;

type ThemeMode = (typeof themeModes)[number];
type ContrastTokenCase = [mode: ThemeMode, foregroundToken: string, backgroundToken: string];

interface RgbColor {
  blue: number;
  green: number;
  red: number;
}

const neutralSemanticTokens = [
  '--background',
  '--foreground',
  '--card',
  '--primary',
  '--secondary',
  '--muted',
  '--accent',
  '--destructive',
  '--success',
  '--warning',
  '--info',
  '--border',
  '--input',
  '--ring'
] as const;

const guardedDesignSurfaceFiles = [
  '../DESIGN.md',
  '../src/renderer/src/styles.css',
  '../src/renderer/src/AppShell.tsx',
  '../src/renderer/src/AppWorkspaceNavigation.tsx'
] as const;

const mutedForegroundContrastCases = themeModes.flatMap((mode) => [
  [mode, '--muted-foreground', '--card'],
  [mode, '--muted-foreground', '--muted'],
  [mode, '--muted-foreground', '--secondary']
] satisfies ContrastTokenCase[]);

const faintMetadataContrastCases = themeModes.flatMap((mode) => [
  [mode, '--color-faint', '--card'],
  [mode, '--color-faint', '--muted']
] satisfies ContrastTokenCase[]);

function getThemeTokenBlock(mode: ThemeMode): string {
  const selector = mode === 'light' ? ':root' : ':root\\[data-theme="dark"\\]';
  const block = new RegExp(`^${selector}\\s*\\{([\\s\\S]*?)^\\}`, 'm').exec(rendererStyles);

  if (block?.[1] === undefined) {
    throw new Error(`${mode} theme token block was not found.`);
  }

  return block[1];
}

function getThemeCustomPropertyValue(mode: ThemeMode, name: string): string {
  const declaration = new RegExp(`^\\s*${name}:\\s*([^;]+);`, 'm').exec(getThemeTokenBlock(mode));

  if (declaration?.[1] === undefined) {
    throw new Error(`${name} declaration was not found in ${mode} theme.`);
  }

  return declaration[1].trim();
}

function getThemeHexCustomProperty(mode: ThemeMode, name: string): string {
  const value = getThemeCustomPropertyValue(mode, name);
  const hexValue = /^#[0-9a-fA-F]{6}$/.exec(value)?.[0];

  if (hexValue === undefined) {
    throw new Error(`${name} in ${mode} theme was not a static hex declaration.`);
  }

  return hexValue;
}

function parseHexColor(hexColor: string): RgbColor {
  return {
    red: Number.parseInt(hexColor.slice(1, 3), 16),
    green: Number.parseInt(hexColor.slice(3, 5), 16),
    blue: Number.parseInt(hexColor.slice(5, 7), 16)
  };
}

function getColorChroma(hexColor: string): number {
  const { blue, green, red } = parseHexColor(hexColor);

  return Math.max(red, green, blue) - Math.min(red, green, blue);
}

function getRgbDistance(firstHexColor: string, secondHexColor: string): number {
  const firstColor = parseHexColor(firstHexColor);
  const secondColor = parseHexColor(secondHexColor);

  return Math.hypot(
    firstColor.red - secondColor.red,
    firstColor.green - secondColor.green,
    firstColor.blue - secondColor.blue
  );
}

function getLinearColorChannel(channel: number): number {
  const normalizedChannel = channel / 255;

  return normalizedChannel <= 0.03928 ? normalizedChannel / 12.92 : ((normalizedChannel + 0.055) / 1.055) ** 2.4;
}

function getRelativeLuminance(hexColor: string): number {
  const { blue, green, red } = parseHexColor(hexColor);

  return 0.2126 * getLinearColorChannel(red) + 0.7152 * getLinearColorChannel(green) + 0.0722 * getLinearColorChannel(blue);
}

function getContrastRatio(foreground: string, background: string): number {
  const foregroundLuminance = getRelativeLuminance(foreground);
  const backgroundLuminance = getRelativeLuminance(background);
  const lighterLuminance = Math.max(foregroundLuminance, backgroundLuminance);
  const darkerLuminance = Math.min(foregroundLuminance, backgroundLuminance);

  return (lighterLuminance + 0.05) / (darkerLuminance + 0.05);
}

describe('renderer theme contract', () => {
  it.each([
    ['light' as const],
    ['dark' as const]
  ])('Given stored %s, When parsed, Then it stays explicit', (storedTheme) => {
    const preference = parseThemePreference(storedTheme);

    expect(preference).toBe(storedTheme);
  });

  it.each([null, undefined, 'sepia'])('Given missing or invalid stored value, When parsed, Then it falls back to system', (storedTheme) => {
    const preference = parseThemePreference(storedTheme);

    expect(preference).toBe('system');
  });

  it('Given system preference and current OS theme, When resolved, Then it mirrors the OS', () => {
    const resolvedLight = resolveThemeMode('system', 'light');
    const resolvedDark = resolveThemeMode('system', 'dark');

    expect(resolvedLight).toBe('light');
    expect(resolvedDark).toBe('dark');
  });

  it('Given light and dark modes, When toggled, Then the opposite explicit mode is returned', () => {
    const toggledToDark = toggleThemeMode('light');
    const toggledToLight = toggleThemeMode('dark');

    expect(toggledToDark).toBe('dark');
    expect(toggledToLight).toBe('light');
  });

  it('Given the theme switch has focus, When Space is pressed, Then the switch key contract requests a toggle', () => {
    const shouldToggleOnSpace = shouldToggleThemeOnSwitchKeyDown(' ');
    const shouldToggleOnLegacySpace = shouldToggleThemeOnSwitchKeyDown('Spacebar');
    const shouldToggleOnEnter = shouldToggleThemeOnSwitchKeyDown('Enter');

    expect(shouldToggleOnSpace).toBe(true);
    expect(shouldToggleOnLegacySpace).toBe(true);
    expect(shouldToggleOnEnter).toBe(false);
  });

  it('Given light theme status-card normal text, When contrast is computed, Then it meets WCAG AA normal text contrast', () => {
    const normalStatusText = getThemeHexCustomProperty('light', '--status-normal');
    const statusSurface = getThemeHexCustomProperty('light', '--muted');
    const contrastRatio = getContrastRatio(normalStatusText, statusSurface);

    expect(contrastRatio).toBeGreaterThanOrEqual(minimumNormalTextContrast);
  });

  it.each(themeModes)('Given %s theme semantic action tokens, When primary is inspected, Then it is not grayscale', (mode) => {
    const primary = getThemeHexCustomProperty(mode, '--primary');

    expect(getColorChroma(primary)).toBeGreaterThanOrEqual(minimumExpressiveColorChroma);
  });

  it.each(themeModes)('Given %s theme semantic accent tokens, When accent is inspected, Then it is a distinct cool accent', (mode) => {
    const accent = getThemeHexCustomProperty(mode, '--accent');
    const primary = getThemeHexCustomProperty(mode, '--primary');
    const { blue, green, red } = parseHexColor(accent);

    expect(green).toBeGreaterThan(red);
    expect(blue).toBeGreaterThan(red);
    expect(getRgbDistance(accent, primary)).toBeGreaterThanOrEqual(minimumDistinctSemanticColorDistance);
  });

  it.each(themeModes)('Given %s theme primary foreground tokens, When contrast is computed, Then it meets WCAG AA normal text contrast', (mode) => {
    const primary = getThemeHexCustomProperty(mode, '--primary');
    const primaryForeground = getThemeHexCustomProperty(mode, '--primary-foreground');
    const contrastRatio = getContrastRatio(primaryForeground, primary);

    expect(contrastRatio).toBeGreaterThanOrEqual(minimumNormalTextContrast);
  });

  it.each(mutedForegroundContrastCases)(
    'Given %s theme muted foreground on %s, When contrast is computed against %s, Then it meets WCAG AA normal text contrast',
    (mode, foregroundToken, backgroundToken) => {
      const foreground = getThemeHexCustomProperty(mode, foregroundToken);
      const background = getThemeHexCustomProperty(mode, backgroundToken);
      const contrastRatio = getContrastRatio(foreground, background);

      expect(contrastRatio).toBeGreaterThanOrEqual(minimumNormalTextContrast);
    }
  );

  it.each(faintMetadataContrastCases)(
    'Given %s theme faint metadata token on %s, When contrast is computed against %s, Then it meets WCAG AA normal text contrast',
    (mode, foregroundToken, backgroundToken) => {
      const foreground = getThemeHexCustomProperty(mode, foregroundToken);
      const background = getThemeHexCustomProperty(mode, backgroundToken);
      const contrastRatio = getContrastRatio(foreground, background);

      expect(contrastRatio).toBeGreaterThanOrEqual(minimumNormalTextContrast);
    }
  );

  it.each(neutralSemanticTokens)('Given the renderer theme CSS, When %s is checked, Then the neutral semantic token exists', (token) => {
    expect(rendererStyles).toMatch(new RegExp(`${token}:\\s*[^;]+;`));
  });

  it('Given Issue #5 bright editor reference, When renderer CSS tokens are checked, Then light mode owns the bright OpenVideo visual contract', () => {
    const lightTheme = getThemeTokenBlock('light');

    expect(lightTheme).toContain('--background: var(--editor-canvas);');
    expect(lightTheme).toContain('--foreground: var(--editor-navy);');
    for (const token of brightEditorContractTokens) {
      expect(lightTheme).toContain(token);
    }
  });

  it('Given Issue #5 bright editor reference, When renderer CSS surfaces are checked, Then existing editor classes use glass, lilac grid, and gradient accents', () => {
    for (const selector of brightEditorSurfaceSelectors) {
      expect(rendererStyles).toContain(selector);
    }

    expect(rendererStyles).toContain('var(--editor-glass)');
    expect(rendererStyles).toContain('var(--editor-glass-border)');
    expect(rendererStyles).toContain('var(--editor-lilac-grid)');
    expect(rendererStyles).toContain('var(--editor-gradient-accent)');
    expect(rendererStyles).not.toContain('linear-gradient(to bottom, #2b2e4a 0%, #171822 100%)');
    expect(rendererStyles).not.toContain('linear-gradient(to bottom, #103126 0%, #091c16 100%)');
  });

  it.each(guardedDesignSurfaceFiles)('Given %s, When brand source text is checked, Then third-party brand copy is absent', (filePath) => {
    const sourceText = readFileSync(new URL(filePath, import.meta.url), 'utf8');

    expect(sourceText).not.toMatch(/cohere/i);
  });
});
