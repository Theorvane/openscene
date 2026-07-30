import { appendFileSync, renameSync, statSync } from 'node:fs';
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

/**
 * electron-updater says a great deal about what it is doing — which release it
 * found, what it downloaded, why a differential download was skipped — and by
 * default says all of it to a console no packaged app has. Diagnosing "the
 * update is not working" then means guessing.
 *
 * Written synchronously and best-effort: a logger that throws, or that loses
 * lines because the process is quitting to install, would be worse than none.
 */
const UPDATER_LOG_MAX_BYTES = 512 * 1024;

function createUpdaterLogger(filePath: string) {
  /**
   * One rotation, not a rolling archive. A long-lived install would otherwise
   * grow this without bound, and nobody needs last year's update checks.
   */
  const rotateIfLarge = (): void => {
    try {
      if (statSync(filePath).size < UPDATER_LOG_MAX_BYTES) return;
      renameSync(filePath, `${filePath}.1`);
    } catch {
      // No file yet, or it cannot be moved; either way, keep appending.
    }
  };

  const write = (level: string, message: unknown, ...rest: unknown[]): void => {
    try {
      rotateIfLarge();
      const detail = [message, ...rest]
        .map((entry) => (entry instanceof Error ? entry.stack ?? entry.message : String(entry)))
        .join(' ');
      appendFileSync(filePath, `${new Date().toISOString()} ${level} ${detail}\n`);
    } catch {
      // Logging must never be the reason an update fails.
    }
  };
  return {
    info: (message: unknown, ...rest: unknown[]) => write('info', message, ...rest),
    warn: (message: unknown, ...rest: unknown[]) => write('warn', message, ...rest),
    error: (message: unknown, ...rest: unknown[]) => write('error', message, ...rest),
    debug: (message: unknown, ...rest: unknown[]) => write('debug', message, ...rest)
  };
}

/** Where the updater's own account of itself is kept. */
export function updaterLogPath(): string {
  return join(app.getPath('userData'), 'updater.log');
}

export function setupUpdater(): UpdaterController {
  const capability = resolveUpdaterCapability();

  autoUpdater.logger = createUpdaterLogger(updaterLogPath());

  // Downloading is a deliberate act, and an install that happens behind a quit
  // is a surprise; the controller drives both explicitly.
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.allowPrerelease = false;

  const controller = createUpdaterController({
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

  // The controller decides whether a progress report is worth a state change;
  // this only forwards what electron-updater reports.
  autoUpdater.on('download-progress', (progress: { percent?: number; transferred?: number; total?: number }) => {
    if (typeof progress.percent !== 'number') return;
    controller.reportDownloadProgress({
      percent: progress.percent,
      ...(typeof progress.transferred === 'number' ? { transferredBytes: progress.transferred } : {}),
      ...(typeof progress.total === 'number' ? { totalBytes: progress.total } : {})
    });
  });

  return controller;
}
