import { AppState, Platform } from 'react-native';

import { interstitialAdUnitId } from './ads';
import { ensureAdsReady, loadAds, type AdsModule, type InterstitialAdInstance } from './adsModule';
import { decideInterstitial } from './exportInterstitial';

/**
 * The interstitial that may follow a finished export.
 *
 * Two calls, in this order:
 *
 *   `prepareExportAd()` when the export starts — the user is already waiting on
 *   the encoder, and that wait is the only window there is. An interstitial
 *   requested at the moment it is shown either makes them wait again or shows
 *   nothing at all.
 *
 *   `showExportAd(succeeded)` once the file has been delivered. Whether anything
 *   appears is `decideInterstitial`'s call, not this module's.
 *
 * State is module-level rather than React state on purpose: the ad outlives the
 * screen that started it, and the frequency cap has to survive a user leaving
 * the project and coming back, which is exactly the case a per-screen counter
 * would miss.
 */

let ads: AdsModule | null | undefined;
let loaded: InterstitialAdInstance | null = null;
let filled = false;
let lastShownAt: number | null = null;

function module(): AdsModule | null {
  if (ads === undefined) ads = loadAds();
  return ads;
}

function unitId(): string | null {
  return interstitialAdUnitId(Platform.OS, __DEV__);
}

function forget(): void {
  // `remove` releases the native ad object behind this instance. Dropping the
  // reference without it leaks one per export.
  void loaded?.remove().catch(() => undefined);
  loaded = null;
  filled = false;
}

/** Requested while the encoder runs, so there is something to show when it stops. */
export function prepareExportAd(): void {
  const sdk = module();
  const unit = unitId();
  if (sdk === null || unit === null || loaded !== null) return;

  void (async () => {
    // LevelPlay has to be initialised — with the app key, and carrying the
    // privacy signals — before any unit is asked for. Requesting first and
    // initialising later is not merely out of order: the request is dropped.
    if (!(await ensureAdsReady(sdk))) return;
    try {
      const ad = new sdk.LevelPlayInterstitialAd(unit);
      ad.setListener({
        onAdLoaded: () => {
          filled = true;
        },
        onAdLoadFailed: () => {
          // A no-fill is a moment rather than a verdict; the next export asks again.
          forget();
        },
        onAdDisplayed: () => undefined,
        onAdDisplayFailed: () => {
          forget();
        },
        onAdClosed: () => {
          // A LevelPlay interstitial instance is single-use — showing a closed
          // one does nothing, silently, which is the failure that looks like
          // "the ad stopped working after the first time".
          forget();
        }
      });
      loaded = ad;
      await ad.loadAd();
    } catch {
      forget();
    }
  })();
}

/**
 * How long a finished export waits for the user to come back before giving up
 * on showing them anything. Long enough to cover a share sheet and a moment's
 * hesitation; short enough that an ad never arrives detached from the export
 * that earned it.
 */
const RETURN_WINDOW_MS = 30_000;

/**
 * Resolves once the app is the thing the user is looking at, or false if that
 * does not happen soon.
 *
 * Delivery on Android goes through a share sheet, which is another activity —
 * so at the instant the delivery promise resolves the app is still `background`
 * and a foreground check taken right then refuses every single time. That is
 * not the case the check exists for. It exists for the phone that was put down
 * during a long export, and the difference between the two is only ever
 * *whether the user comes back*, which is a question that has to be waited on
 * rather than sampled.
 */
function whenForeground(): Promise<boolean> {
  if (AppState.currentState === 'active') return Promise.resolve(true);
  return new Promise((resolve) => {
    const settle = (value: boolean): void => {
      clearTimeout(timer);
      subscription.remove();
      resolve(value);
    };
    const timer = setTimeout(() => settle(false), RETURN_WINDOW_MS);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') settle(true);
    });
  });
}

/**
 * Shown only if the export succeeded, a unit exists, an ad filled, and it has
 * been long enough. Resolves whether anything was shown, so a caller can order
 * its own UI against it.
 */
export async function showExportAd(exportSucceeded: boolean, now = Date.now()): Promise<boolean> {
  // Waited on before deciding, not sampled: see `whenForeground`.
  const appActive = exportSucceeded ? await whenForeground() : false;
  const decision = decideInterstitial({
    exportSucceeded,
    unitId: unitId(),
    adFilled: filled,
    appActive,
    lastShownAt,
    now
  });
  if (!decision.show || loaded === null) {
    // A failed export clears the preloaded ad rather than holding it for the
    // next one: it was requested for a moment that did not arrive. A
    // backgrounded app keeps it — the moment did arrive, the user was simply
    // not there for it, and the next export is a fair place to show it.
    if (!exportSucceeded) forget();
    return false;
  }
  try {
    await loaded.showAd(null);
    lastShownAt = now;
    return true;
  } catch {
    forget();
    return false;
  }
}

/** Test seam: the module-level state is deliberate, and deliberate state has to be resettable. */
export function resetExportAdForTests(): void {
  ads = undefined;
  lastShownAt = null;
  forget();
}
