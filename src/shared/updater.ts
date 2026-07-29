// The updater's vocabulary, shared by the main-process controller that owns the
// state and the renderer that draws it. Kept here so neither side can drift into
// describing a state the other does not have.

export type UpdaterState =
  | { readonly status: 'disabled'; readonly reason: string }
  | { readonly status: 'idle' }
  | { readonly status: 'checking' }
  | { readonly status: 'up-to-date' }
  | { readonly status: 'downloading'; readonly version: string }
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
  readonly platform: NodeJS.Platform;
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
      return { kind: 'none', label: `Downloading ${state.version}…` };
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
      return `Downloading ${state.version}.`;
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
