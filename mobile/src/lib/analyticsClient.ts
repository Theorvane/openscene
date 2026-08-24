import { useCallback, useEffect, useState } from 'react';
import { Directory, File, Paths } from 'expo-file-system';

import {
  OPENPANEL_API_URL,
  OPENPANEL_CLIENT_ID,
  OPENPANEL_ORIGIN,
  filterOpenPanelPayload,
  isAnalyticsEvent,
  sanitiseProperties,
  type AnalyticsEvent,
  type AnalyticsProperties
} from './analytics';

/**
 * The reporting itself: the switch, and the one call the screens use.
 *
 * On by default, off in Settings, and the choice is read before anything is
 * sent rather than checked at the far end — a client that is initialised and
 * then told to be quiet has already announced itself.
 *
 * There is no user identifier. `identify` is never called, no account exists,
 * and the app deliberately does not create one to count with. What is left is
 * a device-scoped anonymous id the SDK manages, which is the least that can be
 * had while still telling one session from two.
 */

const FILE = new File(new Directory(Paths.document), 'analytics.json');

type Stored = { readonly enabled?: boolean };

/**
 * Absent reads as on. The switch records a decision; no decision is the default.
 *
 * The two "no preference" paths deliberately resolve opposite ways, which is
 * worth saying out loud because it looks like an inconsistency. **No file** means
 * nobody has ever touched the switch — the default, and the default is on.
 * **An unreadable file** means somebody's decision exists and cannot be read, and
 * the one thing that must not happen is overriding a "no" because the file was
 * corrupt. Off is the only side that cannot be wrong about someone's wishes.
 */
export function analyticsEnabled(): boolean {
  try {
    if (!FILE.exists) return true;
    return (JSON.parse(FILE.textSync()) as Stored).enabled !== false;
  } catch {
    return false;
  }
}

function writeEnabled(enabled: boolean): void {
  try {
    FILE.write(JSON.stringify({ enabled }));
  } catch {
    // Nothing to do: the next read falls back to off, which is the safe way to
    // fail for a thing that sends data.
  }
}

type Client = {
  track(name: string, properties?: Record<string, unknown>): Promise<unknown> | void;
  clear(): void;
  api: { addHeader(key: string, value: string): void };
};

let client: Client | null | undefined;

/**
 * Loaded lazily, like the ad SDK and for the same reason: a top-level import of
 * something the runtime cannot provide takes the app down while the module
 * graph is still loading, before a screen ever mounts. The platform-neutral
 * core client is intentional: the React Native adapter currently calls an Expo
 * API that is absent from this app’s Expo 57 runtime.
 */
function load(): Client | null {
  if (client !== undefined) return client;
  client = null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const required: unknown = require('@openpanel/sdk');
    const candidate = (required as { OpenPanel?: new (o: unknown) => Client }).OpenPanel;
    if (typeof candidate === 'function') {
      // No `clientSecret`. It exists in the options and is for server-to-server
      // events; an app on someone's phone is neither, and a secret shipped in a
      // binary is a secret anyone can read out of it.
      //
      // No storage or networkInfo adapter either, which the SDK takes to
      // persist its queue across restarts. Events that could not be delivered
      // are dropped instead of following the user into the next session — a
      // smaller record for a question nobody is asking.
      client = new candidate({
        clientId: OPENPANEL_CLIENT_ID,
        apiUrl: OPENPANEL_API_URL,
        // Filter the payload at the SDK send seam too, before it is serialised.
        filter: filterOpenPanelPayload
      });
      // OpenPanel's self-hosted CORS policy admits the native app through this
      // explicit identity. React Native does not supply a browser Origin itself.
      client.api.addHeader('Origin', OPENPANEL_ORIGIN);
    }
  } catch {
    client = null;
  }
  return client;
}

/**
 * Reports an event, if the user has not turned this off.
 *
 * Never throws and never awaits: a screen that is exporting a video must not
 * slow down or fall over because a dashboard is unreachable.
 */
export function track(event: AnalyticsEvent, properties: AnalyticsProperties = {}): void {
  if (!isAnalyticsEvent(event)) return;
  if (!analyticsEnabled()) return;
  try {
    // Not awaited: a screen exporting a video must not wait on a dashboard.
    void load()?.track(event, sanitiseProperties(properties));
  } catch {
    // Reporting is never worth an interruption.
  }
}

/** The Settings switch. */
export function useAnalyticsPreference() {
  const [enabled, setEnabled] = useState(true);
  useEffect(() => setEnabled(analyticsEnabled()), []);

  const set = useCallback((next: boolean) => {
    writeEnabled(next);
    setEnabled(next);
    // Turning it off drops whatever the SDK was holding, so nothing queued
    // before the decision is delivered after it.
    if (!next) {
      try {
        load()?.clear();
      } catch {
        // Nothing held, or nothing to clear.
      }
    }
  }, []);

  return { enabled, set };
}
