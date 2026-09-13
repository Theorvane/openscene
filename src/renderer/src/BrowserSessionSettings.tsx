import { useCallback, useEffect, useState, type ReactElement } from 'react';

import {
  BROWSER_SESSION_PROVIDERS,
  DEFAULT_GOOGLE_FLOW_PREFERENCES,
  GOOGLE_FLOW_PREFERENCES_STORAGE_KEY,
  getBrowserSessionProviderPolicy,
  parseGoogleFlowPreferences,
  serializeGoogleFlowPreferences,
  type GoogleFlowPreferences,
  type BrowserSessionProviderId,
  type BrowserSessionStatus
} from '../../shared/browserSession';
import { Button, StatusCard } from './ui';

type BrowserSessionViewState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly statuses: readonly BrowserSessionStatus[] }
  | { readonly kind: 'error'; readonly message: string };

function readFlowPreferences(): GoogleFlowPreferences {
  try {
    return parseGoogleFlowPreferences(window.localStorage.getItem(GOOGLE_FLOW_PREFERENCES_STORAGE_KEY));
  } catch {
    return DEFAULT_GOOGLE_FLOW_PREFERENCES;
  }
}

function statusLabel(status: BrowserSessionStatus): string {
  switch (status.kind) {
    case 'disconnected': return 'Not connected';
    case 'stored': return 'Encrypted session stored';
    case 'expired': return 'Session expired';
    case 'needs_user_action': return status.reason ?? 'Finish sign-in in the isolated window';
  }
}

export function BrowserSessionSettings(): ReactElement {
  const [state, setState] = useState<BrowserSessionViewState>({ kind: 'loading' });
  const [busyProvider, setBusyProvider] = useState<BrowserSessionProviderId | null>(null);
  const [flowPreferences, setFlowPreferences] = useState<GoogleFlowPreferences>(readFlowPreferences);

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const response = await window.videoTool.getBrowserSessionStatuses();
      setState(response.ok
        ? { kind: 'ready', statuses: response.value }
        : { kind: 'error', message: response.error.message });
    } catch (error: unknown) {
      setState({ kind: 'error', message: error instanceof Error ? error.message : 'Browser session status could not be read.' });
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const run = async (providerId: BrowserSessionProviderId, action: 'start' | 'clear'): Promise<void> => {
    setBusyProvider(providerId);
    try {
      const response = action === 'start'
        ? await window.videoTool.startBrowserSession(providerId)
        : await window.videoTool.clearBrowserSession(providerId);
      if (!response.ok) {
        setState({ kind: 'error', message: response.error.message });
        return;
      }
      await refresh();
    } catch (error: unknown) {
      setState({ kind: 'error', message: error instanceof Error ? error.message : 'Browser session action failed.' });
    } finally {
      setBusyProvider(null);
    }
  };

  const toggleFlowWindow = (): void => {
    const next: GoogleFlowPreferences = {
      schemaVersion: 1,
      showWindowDuringGeneration: !flowPreferences.showWindowDuringGeneration
    };
    setFlowPreferences(next);
    try {
      window.localStorage.setItem(GOOGLE_FLOW_PREFERENCES_STORAGE_KEY, serializeGoogleFlowPreferences(next));
    } catch {
      // The preference remains active for this run if browser storage is unavailable.
    }
  };

  return (
    <div className="settings-group">
      <h3 className="settings-subheading">Browser sessions (experimental)</h3>
      <StatusCard tone="warning">
        Personal desktop use only. Sign in yourself in an isolated window. OpenScene does not read another browser's profile,
        bypass CAPTCHA or expose cookies to this screen. Provider UI changes can break this lane; API keys remain the stable option.
      </StatusCard>
      {state.kind === 'loading' && <StatusCard tone="neutral">Reading encrypted session status.</StatusCard>}
      {state.kind === 'error' && <StatusCard tone="danger">{state.message}</StatusCard>}
      <div className="settings-list">
        <div className="settings-list__row">
          <div className="settings-list__main settings-list__main--stacked">
            <span className="settings-list__name">Show Google Flow while generating</span>
            <span className="settings-list__note">
              Recommended during beta. Closing the Flow window cancels the current image job.
            </span>
          </div>
          <Button
            variant="default"
            aria-pressed={flowPreferences.showWindowDuringGeneration}
            onClick={toggleFlowWindow}
          >
            {flowPreferences.showWindowDuringGeneration ? 'Visible' : 'Hidden'}
          </Button>
        </div>
        {BROWSER_SESSION_PROVIDERS.map((providerId) => {
          const policy = getBrowserSessionProviderPolicy(providerId);
          const status = state.kind === 'ready'
            ? state.statuses.find((candidate) => candidate.providerId === providerId)
            : undefined;
          const stored = status?.kind === 'stored' || status?.kind === 'expired';
          const busy = busyProvider === providerId;
          return (
            <div key={providerId} className="settings-list__row">
              <div className="settings-list__main settings-list__main--stacked">
                <span className="settings-list__name">{policy.label}</span>
                <span className="settings-list__note">
                  {status === undefined ? 'Status unavailable' : statusLabel(status)} · {policy.applicationOrigin}
                  {status?.expiresAt === undefined ? '' : ` · latest cookie expiry ${new Date(status.expiresAt).toLocaleString()}`}
                </span>
                {providerId === 'grok' && (
                  <span className="settings-list__note">
                    If xAI remains on a loading spinner after CAPTCHA, wait for the diagnostic marker, close the sign-in window,
                    and share only console lines beginning with [OpenScene][Browser Session][grok].
                  </span>
                )}
              </div>
              <Button variant="default" onClick={() => void run(providerId, 'start')} disabled={busy}>
                {busy ? 'Waiting for sign-in…' : stored ? 'Open / re-authenticate' : 'Sign in'}
              </Button>
              {stored && (
                <Button variant="ghost" onClick={() => void run(providerId, 'clear')} disabled={busy}>
                  Clear session
                </Button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
