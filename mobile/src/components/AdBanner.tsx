import { useEffect, useState } from 'react';
import { Keyboard, Platform, StyleSheet, View } from 'react-native';

import { bannerAdUnitId } from '../lib/ads';
import { ensureAdsReady, loadAds } from '../lib/adsModule';
import { theme } from '../lib/theme';

/**
 * The banner, above the tab bar.
 *
 * Loaded at the point of use rather than imported at the top. The Unity LevelPlay
 * SDK is native, so a client without it — Expo Go, or any build made before this
 * — cannot provide it, and a top-level import of an unavailable native module
 * throws while the module graph is still loading and takes the whole app down
 * before a screen mounts. `expo-media-library` did exactly that here once
 * already; this is the same lesson applied before it costs anything.
 *
 * Placement is deliberate. Every mediated network's policies are specific about
 * ads a user can tap by accident, and the tab bar directly below is five 44pt
 * targets. The banner therefore gets its own block with a rule above it and the
 * bar's own border below, rather than sharing an edge with anything tappable —
 * and it is hidden entirely while the keyboard is up, where it would sit between
 * the composer and the user's thumb.
 */

/** Long enough that a dead network is not retried at cost, short enough to recover. */
const RETRY_AFTER_MS = 60_000;

/**
 * The fixed 320×50 banner rather than an adaptive one.
 *
 * `LevelPlayAdSize.createAdaptiveAdSize` is a promise that can resolve null, so
 * an adaptive banner is a second failure mode between mount and first request.
 * The block below is centred and sized for this, and the tab bar's position does
 * not depend on which of the two arrives.
 */
const BANNER_WIDTH = 320;
const BANNER_HEIGHT = 50;

export function AdBanner() {
  // Resolved once: `require` is cached, but asking on every render made this run
  // on each keystroke that moved the keyboard.
  const [ads] = useState(() => loadAds());
  const unitId = bannerAdUnitId(Platform.OS, __DEV__);
  /**
   * LevelPlay has to be initialised with the app key before any unit is asked
   * for, and initialisation carries the privacy signals with it — so the banner
   * does not render until that has resolved. See `ensureAdsReady`.
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
      const allowed = await ensureAdsReady(ads);
      if (!cancelled && allowed) setReady(true);
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
      <ads.LevelPlayBannerAdView
        adUnitId={unitId}
        adSize={ads.LevelPlayAdSize.BANNER}
        placementName={null}
        style={styles.banner}
        listener={{
          onAdLoaded: () => setFailed(false),
          onAdLoadFailed: () => setFailed(true)
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  // Its own block, with a rule above it: the tab bar's targets start immediately
  // below, and an ad sharing an edge with a button is the accidental tap every
  // one of these networks' policies is written about.
  root: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 4,
    borderTopWidth: 1,
    borderTopColor: theme.line,
    backgroundColor: theme.bg
  },
  // A native view with no intrinsic size in React Native's layout: without this
  // it measures zero and the ad is present, paid for, and invisible.
  banner: {
    width: BANNER_WIDTH,
    height: BANNER_HEIGHT
  }
});
