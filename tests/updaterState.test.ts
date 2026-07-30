import { describe, expect, it } from 'vitest';

import {
  describeUpdaterState,
  updaterActionFor,
  updaterCapability,
  type UpdaterState
} from '../src/shared/updater';

describe('updater capability', () => {
  it('refuses to update a build running from source', () => {
    // Given / When
    const capability = updaterCapability({ platform: 'darwin', packaged: false });

    // Then
    expect(capability.kind).toBe('none');
  });

  it('lets an unsigned macOS build detect an update but never install one', () => {
    // Given / When
    // Squirrel.Mac verifies the running app before replacing it, so an unsigned
    // build would download an update that fails at the last step.
    const capability = updaterCapability({ platform: 'darwin', packaged: true });

    // Then
    expect(capability.kind).toBe('notify');
    expect(capability.kind === 'notify' && capability.reason).toMatch(/unsigned/);
  });

  it('installs on macOS once the build is signed', () => {
    // Given / When
    const capability = updaterCapability({ platform: 'darwin', packaged: true, macSigned: true });

    // Then
    expect(capability.kind).toBe('install');
  });

  it('installs from an AppImage and only notifies from a package-managed install', () => {
    // Given / When / Then
    expect(updaterCapability({ platform: 'linux', packaged: true, appImagePath: '/tmp/OpenVideo.AppImage' }).kind).toBe(
      'install'
    );
    expect(updaterCapability({ platform: 'linux', packaged: true, appImagePath: undefined }).kind).toBe('notify');
    expect(updaterCapability({ platform: 'linux', packaged: true, appImagePath: '' }).kind).toBe('notify');
  });

  it('installs on Windows', () => {
    // Given / When / Then
    expect(updaterCapability({ platform: 'win32', packaged: true }).kind).toBe('install');
  });
});

describe('updater action', () => {
  it('offers no action while work is in flight', () => {
    // Given
    const inFlight: readonly UpdaterState[] = [
      { status: 'checking' },
      { status: 'downloading', version: '0.2.0' },
      { status: 'installing', version: '0.2.0' }
    ];

    // When / Then
    for (const state of inFlight) {
      expect(updaterActionFor(state).kind).toBe('none');
    }
  });

  it('offers a restart once an update is downloaded', () => {
    // Given / When
    const action = updaterActionFor({ status: 'ready', version: '0.2.0' });

    // Then
    expect(action.kind).toBe('install');
    expect(action.label).toContain('0.2.0');
  });

  it('sends the user to the release when this build cannot install it', () => {
    // Given / When
    const action = updaterActionFor({
      status: 'available',
      version: '0.2.0',
      releaseUrl: 'https://github.com/Theorvane/openvideo/releases/tag/v0.2.0'
    });

    // Then
    expect(action.kind).toBe('open-release');
  });

  it('falls back to checking from idle, up-to-date, and error', () => {
    // Given / When / Then
    expect(updaterActionFor({ status: 'idle' }).kind).toBe('check');
    expect(updaterActionFor({ status: 'up-to-date' }).kind).toBe('check');
    expect(updaterActionFor({ status: 'error', message: 'network down' }).kind).toBe('check');
    // Disabled is the one non-working state that must not invite a retry.
    expect(updaterActionFor({ status: 'disabled', reason: 'runs from source' }).kind).toBe('none');
  });
});

describe('updater description', () => {
  it('names the running version when there is nothing to report', () => {
    // Given / When / Then
    expect(describeUpdaterState({ status: 'idle' }, '0.1.0')).toContain('0.1.0');
    expect(describeUpdaterState({ status: 'up-to-date' }, '0.1.0')).toContain('0.1.0');
  });

  it('surfaces the reason rather than a generic failure', () => {
    // Given / When / Then
    expect(describeUpdaterState({ status: 'disabled', reason: 'runs from source' }, '0.1.0')).toBe('runs from source');
    expect(describeUpdaterState({ status: 'error', message: 'ENOTFOUND github.com' }, '0.1.0')).toBe(
      'ENOTFOUND github.com'
    );
  });

  it('says plainly that an available update has to be downloaded by hand', () => {
    // Given / When
    const text = describeUpdaterState(
      { status: 'available', version: '0.2.0', releaseUrl: 'https://example.test' },
      '0.1.0'
    );

    // Then
    expect(text).toContain('0.2.0');
    expect(text).toMatch(/cannot update itself/);
  });
});

describe('download progress', () => {
  it('formats percent and bytes, degrading to what is known', async () => {
    const { formatDownloadProgress, formatTransferSize } = await import('../src/shared/updater');

    expect(formatDownloadProgress({ percent: 41.6, transferredBytes: 63_000_000, totalBytes: 151_000_000 })).toBe(
      '42% · 63 MB of 151 MB'
    );
    // A progress event does not always carry a total; a percentage alone is
    // still worth showing.
    expect(formatDownloadProgress({ percent: 7 })).toBe('7%');
    expect(formatDownloadProgress({})).toBe('starting');
    expect(formatTransferSize(2_400_000_000)).toBe('2.4 GB');
    expect(formatTransferSize(-1)).toBe('0 MB');
  });

  it('puts the percentage in the label and the description', async () => {
    const { updaterActionFor, describeUpdaterState } = await import('../src/shared/updater');
    const state = { status: 'downloading', version: '0.3.0', percent: 42.4 } as const;

    expect(updaterActionFor(state).label).toBe('Downloading 0.3.0… 42%');
    expect(describeUpdaterState(state, '0.2.0')).toContain('42%');
    // Before the first event there is no number to show, and inventing 0% would
    // read as stalled.
    expect(updaterActionFor({ status: 'downloading', version: '0.3.0' }).label).toBe('Downloading 0.3.0…');
  });
});
