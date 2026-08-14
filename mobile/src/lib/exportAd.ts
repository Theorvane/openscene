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
let unsubscribe: (() => void) | null = null;

function module(): AdsModule | null {
  if (ads === undefined) ads = loadAds();
  return ads;
}

function unitId(): string | null {
  return interstitialAdUnitId(Platform.OS, __DEV__);
}

function forget(): void {
  unsubscribe?.();
  unsubscribe = null;
  loaded = null;
  filled = false;
}

/** Requested while the encoder runs, so there is something to show when it stops. */
export function prepareExportAd(): void {
  const sdk = module();
  const factory = sdk?.InterstitialAd;
  const unit = unitId();
  if (sdk === null || factory === undefined || unit === null || loaded !== null) return;

  void (async () => {
    // Consent gates the request itself, not merely the presentation — asking
    // first and checking later is the compliance failure, and nothing on screen
    // would reveal it.
    if (!(await ensureAdsReady(sdk))) return;
    try {
      const ad = factory.createForAdRequest(unit);
      const events = sdk.AdEventType ?? {};
      const off = [
        ad.addAdEventListener(events.LOADED ?? 'loaded', () => {
          filled = true;
        }),
        ad.addAdEventListener(events.ERROR ?? 'error', () => {
          // A no-fill is a moment rather than a verdict; the next export asks again.
          forget();
        }),
        ad.addAdEventListener(events.CLOSED ?? 'closed', () => {
          // An interstitial instance is single-use — showing a closed one does
          // nothing, silently, which is the failure that looks like "the ad
          // stopped working after the first time".
          forget();
        })
      ];
      loaded = ad;
      unsubscribe = () => {
        for (const remove of off) remove();
      };
      ad.load();
    } catch {
      forget();
    }
  })();
}

/**
 * Shown only if the export succeeded, consent allows it, a unit exists, and it
 * has been long enough. Resolves whether anything was shown, so a caller can
 * order its own UI against it.
 */
export async function showExportAd(exportSucceeded: boolean, now = Date.now()): Promise<boolean> {
  const decision = decideInterstitial({
    exportSucceeded,
    unitId: unitId(),
    adFilled: filled,
    appActive: AppState.currentState === 'active',
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
    await loaded.show();
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
