import { TurboModuleRegistry } from 'react-native';

/**
 * The one place that touches the Google Mobile Ads SDK.
 *
 * Both placements need the same three things — is the SDK in this binary, hand
 * it to me, and may I request an ad yet — and the first of those is the part
 * that cost two red screens to get right. Doing it once means the next placement
 * cannot get it wrong.
 */

type BannerComponent = React.ComponentType<{
  readonly unitId: string;
  readonly size: string;
  readonly onAdFailedToLoad?: (error: unknown) => void;
}>;

export type InterstitialAdInstance = {
  addAdEventListener(type: string, listener: (payload?: unknown) => void): () => void;
  load(): void;
  show(): Promise<unknown>;
};

export type AdsModule = {
  readonly BannerAd: BannerComponent;
  readonly BannerAdSize: Record<string, string>;
  readonly MobileAds: () => { initialize(): Promise<unknown> };
  readonly AdsConsent: {
    requestInfoUpdate(): Promise<unknown>;
    loadAndShowConsentFormIfRequired(): Promise<unknown>;
    getConsentInfo(): Promise<{ canRequestAds?: boolean }>;
  };
  /** Present in every shipped version of the package; typed optional so a build without it degrades. */
  readonly InterstitialAd?: { createForAdRequest(unitId: string): InterstitialAdInstance };
  readonly AdEventType?: Record<string, string>;
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
export function hasAdsNativeModule(): boolean {
  try {
    return TurboModuleRegistry.get('RNGoogleMobileAdsModule') != null;
  } catch {
    return false;
  }
}

/** Only ever called once the native side is known to be present. */
export function loadAds(): AdsModule | null {
  if (!hasAdsNativeModule()) return null;
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

/**
 * Consent, then initialisation, then permission to ask for an ad.
 *
 * Google's own guidance is "before requesting ads, use `canRequestAds` to check
 * if you've obtained consent" — so nothing requests anything until this resolves
 * true. Where no consent is required the form is skipped and this returns
 * quickly; where it is required, showing it *is* the requirement.
 */
export async function ensureAdsReady(ads: AdsModule): Promise<boolean> {
  try {
    await ads.AdsConsent.requestInfoUpdate();
    await ads.AdsConsent.loadAndShowConsentFormIfRequired();
  } catch {
    // Fall through: `canRequestAds` still decides, and it is the part that gates.
  }
  try {
    const info = await ads.AdsConsent.getConsentInfo();
    if (info.canRequestAds !== true) return false;
    await ads.MobileAds().initialize();
    return true;
  } catch {
    // No consent, or no SDK to initialise: no ad, and nothing said.
    return false;
  }
}
