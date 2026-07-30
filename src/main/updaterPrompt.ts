import { updaterPromptFor } from '../shared/updater';
import type { UpdaterController } from './updaterController';

/**
 * Puts an update in front of the user and acts on their answer.
 *
 * Deliberately free of Electron imports. `updater.ts` pulls in electron-updater,
 * which reads `app.getVersion()` the moment it is loaded, so anything importing
 * it cannot be tested outside Electron. The dialog and the browser handoff
 * arrive as arguments instead, which is also why the wiring here is testable at
 * all.
 */
export type ShowMessageBox = (input: {
  readonly type: 'question' | 'info' | 'error';
  readonly title: string;
  readonly message: string;
  readonly buttons: string[];
  readonly defaultId: number;
  readonly cancelId: number;
}) => Promise<{ readonly response: number }>;

export type PromptForUpdateOptions = {
  /**
   * The difference between the startup path and the menu item: on launch only a
   * real update is worth interrupting for, and when the user asked, an
   * up-to-date answer *is* the answer.
   */
  readonly reportNothingToDo: boolean;
  readonly showMessageBox: ShowMessageBox;
  readonly openExternal: (url: string) => Promise<unknown>;
};

export async function promptForUpdate(
  controller: UpdaterController,
  options: PromptForUpdateOptions
): Promise<void> {
  const state = await controller.check();
  const prompt = updaterPromptFor(state, { reportNothingToDo: options.reportNothingToDo });
  if (prompt === null) return;

  const { response } = await options.showMessageBox({
    type: prompt.kind,
    title: prompt.title,
    message: prompt.message,
    buttons: [...prompt.buttons],
    defaultId: 0,
    // The last button is the way out. For a single-button report it is the same
    // button, so dismissing can never be mistaken for confirming.
    cancelId: prompt.buttons.length - 1
  });

  if (response !== 0 || prompt.confirmAction === 'dismiss') return;

  if (prompt.confirmAction === 'install') {
    await controller.install();
    return;
  }

  if (prompt.confirmAction === 'open-release' && state.status === 'available') {
    await options.openExternal(state.releaseUrl);
  }
}
