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
