import { NativeModules, Platform } from 'react-native';

import { levelPlayAppKey } from './ads';

import type {
  AdFormat,
  LevelPlayAdSize,
  LevelPlayBannerAdViewProps,
  LevelPlayInitRequest,
  LevelPlayInterstitialAd as LevelPlayInterstitialAdClass
} from 'ironsource-mediation';

/**
 * The one place that touches the Unity LevelPlay SDK.
 *
 * Both placements need the same three things — is the SDK in this binary, hand
 * it to me, and is it initialised yet — and the first of those is the part that
 * cost two red screens to get right under the AdMob binding. Doing it once means
 * the next placement cannot get it wrong.
 *
 * `import type` above is erased at compile time, so nothing here loads the
 * package before `loadAds` decides it is safe to.
 */

export type InterstitialAdInstance = InstanceType<typeof LevelPlayInterstitialAdClass>;

export type AdsModule = {
  readonly LevelPlay: {
    init(request: LevelPlayInitRequest, listener: { onInitSuccess: (configuration: unknown) => void; onInitFailed: (error: unknown) => void }): Promise<void>;
    setConsent(isConsent: boolean): Promise<void>;
    setMetaData(key: string, values: string[]): Promise<void>;
    launchTestSuite(): Promise<void>;
  };
  readonly LevelPlayInitRequest: { builder(appKey: string): { withLegacyAdFormats(formats: AdFormat[]): { build(): LevelPlayInitRequest } } };
  readonly LevelPlayInterstitialAd: new (adUnitId: string) => InterstitialAdInstance;
  readonly LevelPlayBannerAdView: React.ComponentType<LevelPlayBannerAdViewProps>;
  readonly LevelPlayAdSize: { BANNER: LevelPlayAdSize; createAdaptiveAdSize(width?: number | null): Promise<LevelPlayAdSize | null> };
  readonly AdFormat: typeof AdFormat;
};

/**
 * Whether this binary has the ad SDK in it, asked without touching the SDK.
 *
 * The obvious approach — require it and catch — was not safe under the AdMob
 * binding, and finding that out cost two red screens: that package registered
 * its TurboModules eagerly with `getEnforcing`, so the throw escaped a `try`
 * around the `require`. `ironsource-mediation` reads `NativeModules` instead,
 * which yields `undefined` rather than throwing, but the question is still asked
 * through React Native's own registry rather than through the package — so the
 * answer arrives before any of the SDK loads, whatever the package does at
 * import time.
 */
export function hasAdsNativeModule(): boolean {
  try {
    return NativeModules.LevelPlayMediation != null;
  } catch {
    return false;
  }
}

/** Only ever called once the native side is known to be present. */
export function loadAds(): AdsModule | null {
  if (!hasAdsNativeModule()) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const required: unknown = require('ironsource-mediation');
    for (const candidate of [required, (required as { default?: unknown } | null)?.default]) {
      const module = candidate as Partial<AdsModule> | undefined;
      if (
        module?.LevelPlay !== undefined &&
        typeof module.LevelPlayInterstitialAd === 'function' &&
        module.LevelPlayBannerAdView !== undefined &&
        module.LevelPlayAdSize !== undefined &&
        module.LevelPlayInitRequest !== undefined
      ) {
        return module as AdsModule;
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Privacy signals, then initialisation, then permission to ask for an ad.
 *
 * LevelPlay ships no consent form of its own — the AdMob binding brought Google's
 * UMP with it, and removing the binding removed the CMP too. What replaces it is
 * the conservative default rather than a prompt: consent is declared *not* given,
 * so every mediated network serves contextual, non-personalised ads, and CCPA's
 * do-not-sell signal is set for the same reason. That is the same posture the app
 * already had — App Tracking Transparency is deliberately not implemented, so
 * there was never personalised inventory to lose.
 *
 * Turning personalised ads on means adding a certified CMP and the ATT prompt
 * first, and passing what the user actually chose to `setConsent` here. Nothing
 * else in the app has to change for that.
 */
export async function ensureAdsReady(ads: AdsModule): Promise<boolean> {
  const appKey = levelPlayAppKey(Platform.OS);
  if (appKey === null) return false;
  initialisation ??= initialise(ads, appKey);
  return initialisation;
}

/**
 * Initialising twice is not an error, but it is a second round trip and a second
 * set of listeners, and both placements call this. The promise is the memo.
 */
let initialisation: Promise<boolean> | null = null;

async function initialise(ads: AdsModule, appKey: string): Promise<boolean> {
  try {
    await ads.LevelPlay.setConsent(false);
    await ads.LevelPlay.setMetaData('do_not_sell', ['true']);
  } catch {
    // Fail closed. These two are the entire privacy posture: without them the
    // mediated networks fall back to their own defaults, which is personalised
    // inventory with no consent behind it and no do-not-sell signal — the exact
    // arrangement this app has never had. Carrying on to `init` would serve ads
    // under a posture the store answers and the privacy policy both deny, and
    // nothing on screen would look different. No signals, no init, no ads.
    return false;
  }
  try {
    // The Test Suite is opted into here rather than granted by anyone: without
    // this flag `launchTestSuite` refuses with "please contact your account
    // manager to enable it", which reads as a permission problem and is not one
    // — the message is a leftover from the SDK's beta. It has to precede `init`,
    // because init is what reads the metadata; setting it afterwards changes
    // nothing and produces exactly the same refusal.
    //
    // Development only, and deliberately not fail-closed: it is a debugging
    // surface rather than a privacy signal, so losing it costs the Test Suite
    // and nothing else. The build that ships has no way to reach it anyway —
    // see the caller in Settings.
    if (__DEV__) await ads.LevelPlay.setMetaData('is_test_suite', ['enable']);
  } catch {
    // No Test Suite this run.
  }
  try {
    const request = ads.LevelPlayInitRequest.builder(appKey)
      .withLegacyAdFormats([ads.AdFormat.BANNER, ads.AdFormat.INTERSTITIAL])
      .build();
    return await new Promise<boolean>((resolve) => {
      void ads.LevelPlay.init(request, {
        onInitSuccess: () => resolve(true),
        onInitFailed: () => resolve(false)
      }).catch(() => resolve(false));
    });
  } catch {
    // No SDK to initialise, or a key it would not accept: no ad, and nothing said.
    return false;
  }
}

/**
 * Opens LevelPlay's Test Suite, which is the only way to see an ad while
 * building.
 *
 * `src/lib/ads.ts` hands a development build no ad unit at all — LevelPlay
 * publishes no test units, and an impression from a developer's own device is
 * invalid traffic — so without this there is nothing to look at between writing
 * the integration and shipping it to a store. The Test Suite serves from the
 * dashboard rather than from live inventory: it lists every configured network,
 * says whether its adapter is actually in the binary, and loads a test ad per
 * placement. That is the check to run on a development build.
 *
 * It needs initialisation, which needs the app key — which a development build
 * does have. Nothing here is reachable from a release build; see the caller.
 *
 * Resolves what happened, so the caller can say so rather than appear to do
 * nothing: the Test Suite is a native screen, and a failed launch looks exactly
 * like a tap that missed.
 */
export async function openAdTestSuite(): Promise<'opened' | 'no-sdk' | 'no-init'> {
  const ads = loadAds();
  if (ads === null) return 'no-sdk';
  if (!(await ensureAdsReady(ads))) return 'no-init';
  try {
    await ads.LevelPlay.launchTestSuite();
    return 'opened';
  } catch {
    return 'no-init';
  }
}

/** Test seam: the memo is deliberate, and deliberate state has to be resettable. */
export function resetAdsInitialisationForTests(): void {
  initialisation = null;
}
