import { readFile, writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';

import { app, shell } from 'electron';
import electronUpdater from 'electron-updater';

import { updaterCapability, type UpdaterCapability } from '../shared/updater';
import { createUpdaterController, type UpdaterController, type UpdaterReadyRecord } from './updaterController';

const { autoUpdater } = electronUpdater;

const RELEASES_BASE_URL = 'https://github.com/Theorvane/openvideo/releases';

export function releaseUrlFor(version: string): string {
  return `${RELEASES_BASE_URL}/tag/v${version}`;
}

export function resolveUpdaterCapability(): UpdaterCapability {
  return updaterCapability({
    platform: process.platform,
    packaged: app.isPackaged,
    appImagePath: process.env.APPIMAGE,
    // The mac targets are signed with a Developer ID certificate and notarized,
    // so Squirrel.Mac can verify the running app and replace it. Builds from
    // before signing landed carry false and stay on the notify path, which is
    // correct: an unsigned running app cannot be updated in place either way.
    macSigned: true
  });
}

// The downloaded-and-waiting version, kept beside the app's other state so a
// relaunch already carrying it does not offer the same update twice.
function createReadyRecordStore(filePath: string) {
  return {
    async get(): Promise<UpdaterReadyRecord | undefined> {
      try {
        const parsed: unknown = JSON.parse(await readFile(filePath, 'utf8'));
        const version = (parsed as { version?: unknown } | null)?.version;
        return typeof version === 'string' && version.length > 0 ? { version } : undefined;
      } catch {
        // A missing or unreadable record only means we do not know of a
        // pending update; the next check establishes the truth again.
        return undefined;
      }
    },
    async set(value: UpdaterReadyRecord): Promise<void> {
      try {
        await writeFile(filePath, JSON.stringify(value), 'utf8');
      } catch {
        // Losing the record costs one redundant offer, not correctness.
      }
    },
    async clear(): Promise<void> {
      try {
        await unlink(filePath);
      } catch {
        // Already gone.
      }
    }
  };
}

export function setupUpdater(): UpdaterController {
  const capability = resolveUpdaterCapability();

  // Downloading is a deliberate act, and an install that happens behind a quit
  // is a surprise; the controller drives both explicitly.
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.allowPrerelease = false;

  return createUpdaterController({
    capability,
    currentVersion: app.getVersion(),
    releaseUrlFor,
    backend: {
      async checkForUpdates() {
        const result = await autoUpdater.checkForUpdates();
        return {
          updateAvailable: result?.isUpdateAvailable === true,
          version: result?.updateInfo?.version
        };
      },
      downloadUpdate: () => autoUpdater.downloadUpdate(),
      quitAndInstall: () => autoUpdater.quitAndInstall(),
      openReleasePage: (version) => shell.openExternal(releaseUrlFor(version))
    },
    persistence: createReadyRecordStore(join(app.getPath('userData'), 'pending-update.json'))
  });
}
