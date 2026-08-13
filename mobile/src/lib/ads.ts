/**
 * The ad units, and the rule about which one a build is allowed to ask for.
 *
 * Development must never request a live unit. Google requires test ads while
 * building, and an impression or a click from a developer's own device is what
 * gets an AdMob account suspended — so the live id is reachable only from a
 * production build, and the choice is made here rather than at the call site
 * where it would be one forgotten conditional away from costing the account.
 *
 * Ids are per platform: an iOS unit does not serve on Android and the reverse,
 * and there is no shared "banner" id to fall back to.
 *
 * The platform and the build flavour arrive as arguments rather than being read
 * here, so this stays a table and a rule with no React Native import of its own
 * — which is what lets the rule that protects the account be tested at all.
 */

const LIVE_BANNER_UNITS = {
  ios: 'ca-app-pub-1548414855954305/6959838161',
  android: 'ca-app-pub-1548414855954305/9606182809'
} as const;

/**
 * Google's own always-fills test units.
 *
 * Written out rather than taken from the SDK's `TestIds`, so that resolving a
 * unit does not require the native module to be present — the same reason the
 * banner component loads that module lazily.
 */
const TEST_BANNER_UNITS = {
  ios: 'ca-app-pub-3940256099942544/2934735716',
  android: 'ca-app-pub-3940256099942544/6300978111'
} as const;

/** Null on a platform with no unit of its own, so nothing asks for someone else's. */
export function bannerAdUnitId(platformOs: string, isDevelopment: boolean): string | null {
  const platform = platformOs === 'ios' ? 'ios' : platformOs === 'android' ? 'android' : null;
  if (platform === null) return null;
  return isDevelopment ? TEST_BANNER_UNITS[platform] : LIVE_BANNER_UNITS[platform];
}
