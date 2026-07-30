import type { HostPlatform } from './models';

// The updater's vocabulary, shared by the main-process controller that owns the
// state and the renderer that draws it. Kept here so neither side can drift into
// describing a state the other does not have.

export type UpdaterState =
  | { readonly status: 'disabled'; readonly reason: string }
  | { readonly status: 'idle' }
  | { readonly status: 'checking' }
  | { readonly status: 'up-to-date' }
  | {
      readonly status: 'downloading';
      readonly version: string;
      /** 0-100, absent until the first progress event arrives. */
      readonly percent?: number;
      readonly transferredBytes?: number;
      readonly totalBytes?: number;
    }
  | { readonly status: 'ready'; readonly version: string }
  | { readonly status: 'installing'; readonly version: string }
  // Detected but not installable here: the platform can read the release and
  // cannot apply it. The version is still worth showing, with a way out.
  | { readonly status: 'available'; readonly version: string; readonly releaseUrl: string }
  | { readonly status: 'error'; readonly message: string };

// What the app is allowed to do about an update on this platform and build.
// 'install' downloads and applies it; 'notify' can only tell the user a newer
// version exists; 'none' cannot even look.
export type UpdaterCapability =
  | { readonly kind: 'install' }
  | { readonly kind: 'notify'; readonly reason: string }
  | { readonly kind: 'none'; readonly reason: string };

export type UpdaterPlatformInput = {
  readonly platform: HostPlatform;
  readonly packaged: boolean;
  // electron-builder sets APPIMAGE for AppImage runs; a .deb install does not
  // have it, and electron-updater has no path for deb.
  readonly appImagePath?: string | undefined;
  // Flips macOS to full auto-update the day an Apple Developer identity exists.
  // Squirrel.Mac verifies the running app's signature before replacing it, so
  // an unsigned build can download an update it can never apply.
  readonly macSigned?: boolean;
};

export function updaterCapability(input: UpdaterPlatformInput): UpdaterCapability {
  if (!input.packaged) {
    return { kind: 'none', reason: 'Updates apply to installed builds; this one runs from source.' };
  }

  if (input.platform === 'darwin') {
    return input.macSigned === true
      ? { kind: 'install' }
      : {
          kind: 'notify',
          reason: 'These macOS builds are unsigned, so an update cannot replace the running app. OpenVideo can still tell you when a new version is out.'
        };
  }

  if (input.platform === 'linux') {
    return typeof input.appImagePath === 'string' && input.appImagePath.length > 0
      ? { kind: 'install' }
      : {
          kind: 'notify',
          reason: 'Only the AppImage build updates itself. A package installed through apt is owned by the package manager.'
        };
  }

  if (input.platform === 'win32') {
    return { kind: 'install' };
  }

  return { kind: 'notify', reason: `No update path is implemented for ${input.platform}.` };
}

export type UpdaterAction =
  | { readonly kind: 'check'; readonly label: string }
  | { readonly kind: 'install'; readonly label: string }
  | { readonly kind: 'open-release'; readonly label: string }
  | { readonly kind: 'none'; readonly label: string };

// One button, whose label and meaning follow the state. Pure so the renderer's
// only decision is where to draw it.
export function updaterActionFor(state: UpdaterState): UpdaterAction {
  switch (state.status) {
    case 'checking':
      return { kind: 'none', label: 'Checking…' };
    case 'downloading':
      return {
        kind: 'none',
        label:
          state.percent === undefined
            ? `Downloading ${state.version}…`
            : `Downloading ${state.version}… ${Math.round(state.percent)}%`
      };
    case 'installing':
      return { kind: 'none', label: 'Installing…' };
    case 'ready':
      return { kind: 'install', label: `Restart to update to ${state.version}` };
    case 'available':
      return { kind: 'open-release', label: `Get ${state.version}` };
    case 'disabled':
      return { kind: 'none', label: 'Updates unavailable' };
    default:
      return { kind: 'check', label: 'Check for updates' };
  }
}

export function describeUpdaterState(state: UpdaterState, currentVersion: string): string {
  switch (state.status) {
    case 'disabled':
      return state.reason;
    case 'idle':
      return `Running ${currentVersion}.`;
    case 'checking':
      return 'Looking for a newer release…';
    case 'up-to-date':
      return `${currentVersion} is the latest release.`;
    case 'downloading':
      return state.percent === undefined
        ? `Downloading ${state.version}.`
        : `Downloading ${state.version} — ${formatDownloadProgress(state)}.`;
    case 'ready':
      return `${state.version} is downloaded and installs on restart.`;
    case 'installing':
      return `Installing ${state.version}. OpenVideo will restart.`;
    case 'available':
      return `${state.version} is out. This build cannot update itself, so the download opens in your browser.`;
    case 'error':
      return state.message;
  }
}

/**
 * What to put in front of the user for a given updater state.
 *
 * Pure, so the decision is testable without Electron: only the dialog call
 * needs the runtime. Modelled on opencode's showUpdaterDialog, including the
 * part that matters most — it stays silent on startup unless there is something
 * to act on. A launch that announces "you are up to date" trains the user to
 * dismiss the box that also carries the real update.
 */
export type UpdaterPromptAction = 'install' | 'open-release' | 'dismiss';

export type UpdaterPrompt = {
  readonly kind: 'question' | 'info' | 'error';
  readonly title: string;
  readonly message: string;
  /** First entry is the default; the last is always the way out. */
  readonly buttons: readonly string[];
  /** What pressing the default button should do. */
  readonly confirmAction: UpdaterPromptAction;
};

export function updaterPromptFor(
  state: UpdaterState,
  options: { readonly reportNothingToDo: boolean }
): UpdaterPrompt | null {
  switch (state.status) {
    case 'ready':
      return {
        kind: 'question',
        title: 'Update ready',
        message: `OpenVideo ${state.version} is downloaded. Restart to install it?`,
        buttons: ['Restart', 'Later'],
        confirmAction: 'install'
      };
    case 'available':
      return {
        kind: 'question',
        title: `OpenVideo ${state.version} is available`,
        message:
          `OpenVideo ${state.version} is out, but this build cannot replace itself. ` +
          'Open the download page to get it?',
        buttons: ['Open download page', 'Later'],
        confirmAction: 'open-release'
      };
    // Everything below is only worth interrupting for when the user asked.
    case 'up-to-date':
      return options.reportNothingToDo
        ? {
            kind: 'info',
            title: 'No updates',
            message: 'OpenVideo is up to date.',
            buttons: ['OK'],
            confirmAction: 'dismiss'
          }
        : null;
    case 'error':
      return options.reportNothingToDo
        ? {
            kind: 'error',
            title: 'Update check failed',
            message: state.message,
            buttons: ['OK'],
            confirmAction: 'dismiss'
          }
        : null;
    case 'disabled':
      return options.reportNothingToDo
        ? {
            kind: 'info',
            title: 'Updates unavailable',
            message: state.reason,
            buttons: ['OK'],
            confirmAction: 'dismiss'
          }
        : null;
    // A check still running, or a download in flight, has nothing to ask yet.
    default:
      return null;
  }
}

/** Whole megabytes below a gigabyte; a byte count means nothing at a glance. */
export function formatTransferSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 MB';
  const megabytes = bytes / 1_000_000;
  return megabytes >= 1_000 ? `${(megabytes / 1_000).toFixed(1)} GB` : `${Math.round(megabytes)} MB`;
}

/**
 * "42% · 63 MB of 151 MB", degrading to whatever is actually known. Progress
 * events do not always carry a total, and a bar with no total is still worth
 * showing as a percentage.
 */
export function formatDownloadProgress(state: {
  readonly percent?: number;
  readonly transferredBytes?: number;
  readonly totalBytes?: number;
}): string {
  const parts: string[] = [];
  if (state.percent !== undefined) parts.push(`${Math.round(state.percent)}%`);
  if (state.transferredBytes !== undefined && state.totalBytes !== undefined && state.totalBytes > 0) {
    parts.push(`${formatTransferSize(state.transferredBytes)} of ${formatTransferSize(state.totalBytes)}`);
  }
  return parts.length === 0 ? 'starting' : parts.join(' · ');
}
