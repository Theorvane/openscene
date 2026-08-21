/**
 * The LevelPlay app keys and ad unit ids, and the rule about which build is
 * allowed to ask for one.
 *
 * Unity LevelPlay (formerly ironSource) mediates here, with Unity Ads, AppLovin,
 * Meta Audience Network and Pangle bidding into it through adapters. That
 * changes one thing about this table compared with the AdMob one it replaces:
 *
 * **LevelPlay has no test ad units.** Google publishes always-fill test ids that
 * a debug build can safely hammer; LevelPlay does not, because every LevelPlay
 * ad unit is real mediated inventory whichever build asks for it. An impression
 * or a click from a developer's own device is invalid traffic, and invalid
 * traffic is what gets a publisher account suspended — so a development build
 * asks for nothing at all, and the sanctioned way to see an ad while building is
 * LevelPlay's own Test Suite (`LevelPlay.launchTestSuite()`), which serves from
 * the dashboard rather than from live inventory.
 *
 * Ids are per platform: an iOS unit does not serve on Android and the reverse,
 * and an app key belongs to one dashboard app rather than to the product.
 *
 * The platform and the build flavour arrive as arguments rather than being read
 * here, so this stays a table and a rule with no React Native import of its own
 * — which is what lets the rule that protects the account be tested at all.
 */

type Platform = 'ios' | 'android';

/**
 * The dashboard app, one per store listing.
 *
 * Needed before anything else: LevelPlay initialises with the app key and every
 * ad unit id below belongs to the app that key names. Null on a platform whose
 * app has not been created yet, so that build initialises nothing rather than
 * initialising against someone else's app.
 */
const APP_KEYS: Partial<Record<Platform, string>> = {
  // "OpenScene: AI 동영상 편집기" in the LevelPlay dashboard.
  ios: '27bc507ad',
  // "OpenScene: AI video studio" — a different listing, and so a different key.
  android: '27bc54135'
};

/** The banner above the tab bar. See `AdBanner`. */
const BANNER_UNITS: Partial<Record<Platform, string>> = {
  ios: '65tx5nxosvpopb4b',
  android: 'hmcgn9ps07dbs3x9'
};

/**
 * The interstitial, shown when an export finishes. See `exportInterstitial`.
 *
 * Partial rather than complete, like the banner: a platform without a unit has
 * to read as "no interstitial here" rather than fall back to one that belongs to
 * a different placement or a different app.
 */
const INTERSTITIAL_UNITS: Partial<Record<Platform, string>> = {
  ios: 'ii71gp04gfktnj8i',
  android: '9etyh0zw8fg8dgou'
};

function platformOf(platformOs: string): Platform | null {
  return platformOs === 'ios' ? 'ios' : platformOs === 'android' ? 'android' : null;
}

/** Null on a platform whose LevelPlay app does not exist, so nothing initialises against another app's key. */
export function levelPlayAppKey(platformOs: string): string | null {
  const platform = platformOf(platformOs);
  if (platform === null) return null;
  return APP_KEYS[platform] ?? null;
}

/**
 * Null in development, and null on a platform with no unit of its own.
 *
 * The development case is the one that matters: there is no test unit to hand
 * back instead, so the only safe answer is none. See the note at the top.
 */
export function bannerAdUnitId(platformOs: string, isDevelopment: boolean): string | null {
  if (isDevelopment) return null;
  const platform = platformOf(platformOs);
  if (platform === null) return null;
  return BANNER_UNITS[platform] ?? null;
}

/** Null in development for the same reason, and null where there is no unit. */
export function interstitialAdUnitId(platformOs: string, isDevelopment: boolean): string | null {
  if (isDevelopment) return null;
  const platform = platformOf(platformOs);
  if (platform === null) return null;
  return INTERSTITIAL_UNITS[platform] ?? null;
}
