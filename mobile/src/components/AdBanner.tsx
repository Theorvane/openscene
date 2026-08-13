import { useEffect, useState } from 'react';
import { Keyboard, Platform, StyleSheet, TurboModuleRegistry, View } from 'react-native';

import { bannerAdUnitId } from '../lib/ads';
import { theme } from '../lib/theme';

/**
 * The banner, above the tab bar.
 *
 * Loaded at the point of use rather than imported at the top. The Google Mobile
 * Ads SDK is native, so a client without it — Expo Go, or any build made before
 * this — cannot provide it, and a top-level import of an unavailable native
 * module throws while the module graph is still loading and takes the whole app
 * down before a screen mounts. `expo-media-library` did exactly that here once
 * already; this is the same lesson applied before it costs anything.
 *
 * Placement is deliberate. AdMob's policies are specific about ads a user can
 * tap by accident, and the tab bar directly below is five 44pt targets. The
 * banner therefore gets its own block with a rule above it and the bar's own
 * border below, rather than sharing an edge with anything tappable — and it is
 * hidden entirely while the keyboard is up, where it would sit between the
 * composer and the user's thumb.
 */

type BannerComponent = React.ComponentType<{
  readonly unitId: string;
  readonly size: string;
  readonly onAdFailedToLoad?: (error: unknown) => void;
}>;

type AdsModule = {
  readonly BannerAd: BannerComponent;
  readonly BannerAdSize: Record<string, string>;
  readonly MobileAds: () => { initialize(): Promise<unknown> };
  readonly AdsConsent: {
    requestInfoUpdate(): Promise<unknown>;
    loadAndShowConsentFormIfRequired(): Promise<unknown>;
    getConsentInfo(): Promise<{ canRequestAds?: boolean }>;
  };
};

/**
 * Whether this binary has the ad SDK in it, asked without touching the SDK.
 *
 * The obvious approach — require it and catch — does not work here, and finding
 * that out cost two red screens. The package's entry registers its TurboModules
 * eagerly with `getEnforcing`, which throws where the native side is missing;
 * the throw escapes a `try` around the `require`, and probing the returned
 * object instead only moves the failure a line later. There is no defensive way
 * to ask the module whether it is there.
 *
 * `TurboModuleRegistry.get` returns null rather than throwing, and it is React
 * Native's own registry rather than the package's — so the question is answered
 * before anything of the SDK is loaded at all.
 */
function hasAdsNativeModule(): boolean {
  try {
    return TurboModuleRegistry.get('RNGoogleMobileAdsModule') != null;
  } catch {
    return false;
  }
}

/** Only ever called once the native side is known to be present. */
function loadAds(): AdsModule | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const required: unknown = require('react-native-google-mobile-ads');
    for (const candidate of [required, (required as { default?: unknown } | null)?.default]) {
      const module = candidate as Partial<AdsModule> | undefined;
      if (
        typeof module?.BannerAd === 'function' &&
        module.BannerAdSize !== undefined &&
        typeof module.MobileAds === 'function' &&
        module.AdsConsent !== undefined
      ) {
        return module as AdsModule;
      }
    }
    return null;
  } catch {
    return null;
  }
}

/** Long enough that a dead network is not retried at cost, short enough to recover. */
const RETRY_AFTER_MS = 60_000;

export function AdBanner() {
  // Resolved once: `require` is cached, but asking on every render made this run
  // on each keystroke that moved the keyboard.
  const [ads] = useState(() => (hasAdsNativeModule() ? loadAds() : null));
  const unitId = bannerAdUnitId(Platform.OS, __DEV__);
  /**
   * Consent first, then initialise, then request. Google's own guidance is
   * "before requesting ads, use `canRequestAds` to check if you've obtained
   * consent from the user" — so the banner does not render until that is true.
   * In regions where no consent is required the form is skipped and this
   * resolves immediately; where it is required, showing it is the requirement.
   */
  const [ready, setReady] = useState(false);
  /**
   * A banner that failed to fill is not a gap to leave behind. Collapsing keeps
   * the tab bar where it was rather than leaving a band of empty app above it —
   * but not forever: a no-fill is usually a moment, and latching it for the life
   * of the screen turned one bad minute into a session with no ads at all.
   */
  const [failed, setFailed] = useState(false);
  const [keyboardUp, setKeyboardUp] = useState(false);

  useEffect(() => {
    const shown = Keyboard.addListener('keyboardDidShow', () => setKeyboardUp(true));
    const hidden = Keyboard.addListener('keyboardDidHide', () => setKeyboardUp(false));
    return () => {
      shown.remove();
      hidden.remove();
    };
  }, []);

  useEffect(() => {
    if (ads === null) return;
    let cancelled = false;
    void (async () => {
      try {
        // A consent form is shown only where one is required; elsewhere these
        // resolve without any UI. A failure here is not a reason to give up on
        // the check that follows, which is the part that actually gates.
        await ads.AdsConsent.requestInfoUpdate();
        await ads.AdsConsent.loadAndShowConsentFormIfRequired();
      } catch {
        // Fall through: `canRequestAds` still decides.
      }
      try {
        const info = await ads.AdsConsent.getConsentInfo();
        if (cancelled || info.canRequestAds !== true) return;
        await ads.MobileAds().initialize();
        if (!cancelled) setReady(true);
      } catch {
        // No consent, or no SDK to initialise: no banner, and nothing said.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ads]);

  useEffect(() => {
    if (!failed) return;
    const timer = setTimeout(() => setFailed(false), RETRY_AFTER_MS);
    return () => clearTimeout(timer);
  }, [failed]);

  if (ads === null || unitId === null || !ready || failed || keyboardUp) return null;

  return (
    <View style={styles.root}>
      <ads.BannerAd
        unitId={unitId}
        size={ads.BannerAdSize.ANCHORED_ADAPTIVE_BANNER ?? ads.BannerAdSize.BANNER ?? 'BANNER'}
        onAdFailedToLoad={() => setFailed(true)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  // Its own block, with a rule above it: the tab bar's targets start immediately
  // below, and an ad sharing an edge with a button is the accidental tap AdMob's
  // policies are written about.
  root: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 4,
    borderTopWidth: 1,
    borderTopColor: theme.line,
    backgroundColor: theme.bg
  }
});
