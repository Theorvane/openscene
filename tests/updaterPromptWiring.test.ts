import { describe, expect, it, vi } from 'vitest';

import { promptForUpdate, type ShowMessageBox } from '../src/main/updaterPrompt';
import { createApplicationMenuTemplate } from '../src/main/applicationMenu';
import type { UpdaterController } from '../src/main/updaterController';
import type { UpdaterState } from '../src/shared/updater';

const noopOpen = async (): Promise<undefined> => undefined;

function fakeController(state: UpdaterState) {
  return {
    getState: () => state,
    subscribe: () => () => undefined,
    start: vi.fn(async () => state),
    check: vi.fn(async () => state),
    install: vi.fn(async () => undefined)
  } as unknown as UpdaterController;
}

describe('promptForUpdate', () => {
  it('installs when the user presses the default button', async () => {
    // Given
    const controller = fakeController({ status: 'ready', version: '0.3.0' });
    const showMessageBox = vi.fn(async () => ({ response: 0 }));

    // When
    await promptForUpdate(controller, { reportNothingToDo: false, showMessageBox, openExternal: noopOpen });

    // Then
    expect(showMessageBox).toHaveBeenCalledTimes(1);
    expect(controller.install).toHaveBeenCalledTimes(1);
  });

  it('does nothing when the user picks Later', async () => {
    // Given
    const controller = fakeController({ status: 'ready', version: '0.3.0' });

    // When
    await promptForUpdate(controller, {
      reportNothingToDo: false,
      showMessageBox: async () => ({ response: 1 }),
      openExternal: noopOpen
    });

    // Then
    // The downloaded update stays ready; nothing restarts on its own.
    expect(controller.install).not.toHaveBeenCalled();
  });

  it('opens the release page instead of installing when the build cannot install', async () => {
    // Given
    const controller = fakeController({
      status: 'available',
      version: '0.3.0',
      releaseUrl: 'https://example.test/v0.3.0'
    });
    const openExternal = vi.fn(async () => undefined);

    // When
    await promptForUpdate(controller, {
      reportNothingToDo: false,
      showMessageBox: async () => ({ response: 0 }),
      openExternal
    });

    // Then
    expect(openExternal).toHaveBeenCalledWith('https://example.test/v0.3.0');
    expect(controller.install).not.toHaveBeenCalled();
  });

  it('shows no dialog at all on a silent launch with nothing to do', async () => {
    // Given
    const controller = fakeController({ status: 'up-to-date' });
    const showMessageBox = vi.fn(async () => ({ response: 0 }));

    // When
    await promptForUpdate(controller, { reportNothingToDo: false, showMessageBox, openExternal: noopOpen });

    // Then
    expect(showMessageBox).not.toHaveBeenCalled();
  });

  it('reports up-to-date when the user asked, without treating OK as an action', async () => {
    // Given
    const controller = fakeController({ status: 'up-to-date' });
    const showMessageBox = vi.fn(async () => ({ response: 0 }));

    // When
    await promptForUpdate(controller, { reportNothingToDo: true, showMessageBox, openExternal: noopOpen });

    // Then
    expect(showMessageBox).toHaveBeenCalledTimes(1);
    expect(controller.install).not.toHaveBeenCalled();
  });

  it('makes the last button the cancel button, so dismissing never confirms', async () => {
    // Given
    const controller = fakeController({ status: 'ready', version: '0.3.0' });
    let captured: Parameters<ShowMessageBox>[0] | null = null;

    // When
    await promptForUpdate(controller, {
      reportNothingToDo: false,
      showMessageBox: async (input) => {
        captured = input;
        return { response: 1 };
      },
      openExternal: noopOpen
    });

    // Then
    const shown = captured as Parameters<ShowMessageBox>[0] | null;
    expect(shown?.defaultId).toBe(0);
    expect(shown?.cancelId).toBe((shown?.buttons.length ?? 0) - 1);
  });
});

describe('application menu', () => {
  it('offers Check for Updates only when a handler is wired', () => {
    // Given / When
    const handler = vi.fn();
    const withUpdates = createApplicationMenuTemplate(vi.fn(), handler);
    const without = createApplicationMenuTemplate(vi.fn());

    // Then
    const labels = (template: readonly { label?: string; submenu?: unknown }[]): string[] =>
      template.flatMap((entry) =>
        Array.isArray(entry.submenu) ? entry.submenu.map((item: { label?: string }) => item.label ?? '') : []
      );

    expect(labels(withUpdates)).toContain('Check for Updates…');
    expect(labels(without)).not.toContain('Check for Updates…');
  });

  it('runs the handler when the item is clicked', () => {
    // Given
    const handler = vi.fn();
    const template = createApplicationMenuTemplate(vi.fn(), handler);

    // When
    const item = template
      .flatMap((entry) => (Array.isArray(entry.submenu) ? entry.submenu : []))
      .find((entry: { label?: string }) => entry.label === 'Check for Updates…') as { click?: () => void };
    item?.click?.();

    // Then
    expect(handler).toHaveBeenCalledTimes(1);
  });
});

describe('menu placement', () => {
  const labelsOf = (template: readonly { label?: string; role?: string; submenu?: unknown }[]) =>
    template.map((entry) => entry.label ?? entry.role ?? '');

  it('puts Check for Updates inside the single macOS app menu, not beside it', () => {
    // Given
    const platform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
    try {
      // When
      const template = createApplicationMenuTemplate(vi.fn(), vi.fn());

      // Then
      // Pushing a second entry labelled OpenScene left the menu bar with two
      // app-named menus: the real one and a stub holding one item.
      expect(labelsOf(template).filter((label) => label === 'OpenScene')).toHaveLength(1);
      const appMenu = template.find((entry) => entry.label === 'OpenScene');
      const items = (appMenu?.submenu as { label?: string; role?: string }[] | undefined) ?? [];
      expect(items.map((item) => item.label ?? item.role)).toContain('Check for Updates…');
      // Folding it in means the standard items have to be there explicitly.
      expect(items.map((item) => item.role)).toContain('quit');
      expect(items.map((item) => item.role)).toContain('about');
    } finally {
      Object.defineProperty(process, 'platform', { value: platform, configurable: true });
    }
  });

  it('keeps the plain app menu role when no handler is wired', () => {
    const platform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
    try {
      const template = createApplicationMenuTemplate(vi.fn());
      expect(template.find((entry) => entry.label === 'OpenScene')?.role).toBe('appMenu');
    } finally {
      Object.defineProperty(process, 'platform', { value: platform, configurable: true });
    }
  });

  it('uses Help on Windows and Linux, which have no app menu', () => {
    const platform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    try {
      const template = createApplicationMenuTemplate(vi.fn(), vi.fn());
      expect(labelsOf(template)).not.toContain('OpenScene');
      const help = template.find((entry) => entry.role === 'help');
      expect((help?.submenu as { label?: string }[] | undefined)?.[0]?.label).toBe('Check for Updates…');
    } finally {
      Object.defineProperty(process, 'platform', { value: platform, configurable: true });
    }
  });
});

describe('startup does not check twice', () => {
  it('prompts from the state start() already resolved', async () => {
    // Given
    const { promptForUpdateState } = await import('../src/main/updaterPrompt');
    const controller = fakeController({ status: 'up-to-date' });
    const showMessageBox = vi.fn(async () => ({ response: 0 }));

    // When
    await promptForUpdateState(controller, { status: 'ready', version: '0.3.0' }, {
      reportNothingToDo: false,
      showMessageBox,
      openExternal: noopOpen
    });

    // Then
    // An up-to-date result is not short-circuited inside check(), so calling it
    // again after start() repeated the network request on every launch.
    expect(controller.check).not.toHaveBeenCalled();
    expect(showMessageBox).toHaveBeenCalledTimes(1);
  });

  it('still checks on the menu path, where the user asked for one', async () => {
    // Given
    const controller = fakeController({ status: 'up-to-date' });

    // When
    await promptForUpdate(controller, {
      reportNothingToDo: true,
      showMessageBox: async () => ({ response: 0 }),
      openExternal: noopOpen
    });

    // Then
    expect(controller.check).toHaveBeenCalledTimes(1);
  });

  it('wires the startup path through the state-taking form', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const index = readFileSync(resolve(process.cwd(), 'src/main/index.ts'), 'utf8');
    expect(index).toContain('.then((state) => promptForUpdateState(updaterController, state,');
  });
});
