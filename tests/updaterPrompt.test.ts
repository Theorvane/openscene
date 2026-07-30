import { describe, expect, it } from 'vitest';

import { updaterPromptFor, type UpdaterState } from '../src/shared/updater';

const SILENT = { reportNothingToDo: false };
const ASKED = { reportNothingToDo: true };

describe('startup prompt', () => {
  it('asks to restart when an update is downloaded', () => {
    // Given / When
    const prompt = updaterPromptFor({ status: 'ready', version: '0.3.0' }, SILENT);

    // Then
    expect(prompt?.kind).toBe('question');
    expect(prompt?.message).toContain('0.3.0');
    expect(prompt?.buttons[0]).toBe('Restart');
    expect(prompt?.confirmAction).toBe('install');
    // The way out is always present: nothing restarts on its own.
    expect(prompt?.buttons).toContain('Later');
  });

  it('offers the download page when this build cannot replace itself', () => {
    // Given / When
    const prompt = updaterPromptFor(
      { status: 'available', version: '0.3.0', releaseUrl: 'https://example.test' },
      SILENT
    );

    // Then
    expect(prompt?.confirmAction).toBe('open-release');
    expect(prompt?.message).toMatch(/cannot replace itself/);
  });

  it('says nothing on launch when there is nothing to act on', () => {
    // Given
    const quiet: readonly UpdaterState[] = [
      { status: 'up-to-date' },
      { status: 'error', message: 'ENOTFOUND github.com' },
      { status: 'disabled', reason: 'runs from source' },
      { status: 'idle' },
      { status: 'checking' },
      { status: 'downloading', version: '0.3.0' },
      { status: 'installing', version: '0.3.0' }
    ];

    // When / Then
    // A launch that announces "you are up to date" trains the user to dismiss
    // the box that also carries the real update.
    for (const state of quiet) {
      expect(updaterPromptFor(state, SILENT), state.status).toBeNull();
    }
  });
});

describe('prompt when the user asked', () => {
  it('reports up-to-date, errors, and disabled', () => {
    // Given / When / Then
    expect(updaterPromptFor({ status: 'up-to-date' }, ASKED)?.kind).toBe('info');
    expect(updaterPromptFor({ status: 'error', message: 'network down' }, ASKED)?.kind).toBe('error');
    expect(updaterPromptFor({ status: 'error', message: 'network down' }, ASKED)?.message).toBe('network down');
    expect(updaterPromptFor({ status: 'disabled', reason: 'runs from source' }, ASKED)?.message).toBe(
      'runs from source'
    );
  });

  it('still says nothing while work is in flight', () => {
    // A check the user just started has no answer yet; the state it settles on
    // is what gets reported.
    expect(updaterPromptFor({ status: 'checking' }, ASKED)).toBeNull();
    expect(updaterPromptFor({ status: 'downloading', version: '0.3.0' }, ASKED)).toBeNull();
  });

  it('never turns a nothing-to-do report into an action', () => {
    for (const state of [
      { status: 'up-to-date' } as const,
      { status: 'error', message: 'x' } as const,
      { status: 'disabled', reason: 'y' } as const
    ]) {
      expect(updaterPromptFor(state, ASKED)?.confirmAction).toBe('dismiss');
      expect(updaterPromptFor(state, ASKED)?.buttons).toEqual(['OK']);
    }
  });
});

describe('updater logging', () => {
  it('sends electron-updater output to a file rather than a console nobody sees', async () => {
    // Given
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const source = readFileSync(resolve(process.cwd(), 'src/main/updater.ts'), 'utf8');

    // Then
    // Without this, diagnosing "the update is not working" means guessing:
    // electron-updater reports which release it found and what it downloaded,
    // and a packaged app has no console to report it to.
    expect(source).toContain('autoUpdater.logger = createUpdaterLogger(updaterLogPath())');
    expect(source).toContain("join(app.getPath('userData'), 'updater.log')");
    // Best-effort: a throwing logger must not be why an update fails.
    expect(source).toMatch(/} catch \{\n\s*\/\/ Logging must never be the reason an update fails\./);
  });

  it('tells the user where that log is', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const settings = readFileSync(resolve(process.cwd(), 'src/renderer/src/UpdatesSettings.tsx'), 'utf8');
    expect(settings).toContain('updater.log');
  });
});

describe('updater log bounds', () => {
  it('rotates once instead of growing without bound', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const source = readFileSync(resolve(process.cwd(), 'src/main/updater.ts'), 'utf8');

    // Raised in review: append-only with no cap. One rotation is enough —
    // nobody needs last year's update checks.
    expect(source).toContain('UPDATER_LOG_MAX_BYTES');
    expect(source).toContain('renameSync(filePath, `${filePath}.1`)');
  });
});
