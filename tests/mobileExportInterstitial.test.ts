import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import { bannerAdUnitId, interstitialAdUnitId } from '../mobile/src/lib/ads';
import { INTERSTITIAL_MIN_GAP_MS, decideInterstitial } from '../mobile/src/lib/exportInterstitial';

/**
 * When a finished export may be followed by a full-screen ad.
 *
 * Where an interstitial goes is the whole of this feature, and every rule here
 * is one AdMob's policies name directly — an ad in front of an action the user
 * asked for, an ad over content that is still loading, an ad in the moment a
 * user is least likely to have meant the tap that dismisses it.
 */

const base = {
  exportSucceeded: true,
  unitId: 'ca-app-pub-3940256099942544/1033173712',
  adFilled: true,
  appActive: true,
  lastShownAt: null,
  now: 10_000_000
} as const;

describe('the export interstitial', () => {
  it('shows once the export has actually produced something', () => {
    expect(decideInterstitial(base)).toEqual({ show: true, because: 'ready' });
  });

  it('never follows a failed export', () => {
    // The worst possible moment: the user has just been told their video did not
    // render, and a full-screen ad arrives over the message explaining why.
    expect(decideInterstitial({ ...base, exportSucceeded: false }).because).toBe('export-failed');
    // And it is refused first, so a build where everything else is in place
    // still cannot show one here.
    expect(
      decideInterstitial({ exportSucceeded: false, unitId: null, adFilled: false, appActive: true, lastShownAt: null, now: 0 })
        .because
    ).toBe('export-failed');
  });

  it('does not punctuate a working session', () => {
    const first = { ...base, lastShownAt: base.now - 1_000 };
    expect(decideInterstitial(first).because).toBe('too-soon');
    // Someone exporting three cuts in a row is one person working.
    expect(decideInterstitial({ ...base, lastShownAt: base.now - INTERSTITIAL_MIN_GAP_MS + 1 }).because).toBe('too-soon');
    expect(decideInterstitial({ ...base, lastShownAt: base.now - INTERSTITIAL_MIN_GAP_MS }).show).toBe(true);
  });

  it('shows nothing to an app the user is not looking at', () => {
    // An export can take minutes and people put the phone down during one. An ad
    // presented to a backgrounded app is an impression nobody saw — invalid, and
    // the account's problem rather than the user's.
    expect(decideInterstitial({ ...base, appActive: false }).because).toBe('not-foreground');
  });

  it('shows nothing when there is no unit and nothing filled', () => {
    expect(decideInterstitial({ ...base, unitId: null }).because).toBe('no-unit');
    expect(decideInterstitial({ ...base, adFilled: false }).because).toBe('not-filled');
  });
});

describe('the interstitial unit', () => {
  it('never hands a development build a live unit', () => {
    for (const platform of ['ios', 'android'] as const) {
      expect(interstitialAdUnitId(platform, true)).toMatch(/^ca-app-pub-3940256099942544\//);
    }
  });

  it('uses the platform own unit in a production build', () => {
    expect(interstitialAdUnitId('ios', false)).toBe('ca-app-pub-1548414855954305/3993164988');
    expect(interstitialAdUnitId('android', false)).toBe('ca-app-pub-1548414855954305/9641715519');
    // Four live units now, and every one of them has to be the placement it is
    // used for. An interstitial served into a banner slot, or the reverse, is a
    // policy violation rather than a rendering bug.
    expect(new Set([
      interstitialAdUnitId('ios', false),
      interstitialAdUnitId('android', false),
      bannerAdUnitId('ios', false),
      bannerAdUnitId('android', false)
    ]).size).toBe(4);
    for (const unit of [interstitialAdUnitId('ios', false), interstitialAdUnitId('android', false)]) {
      // A unit uses `/`; the `~` form is the app id, and swapping the two fails
      // only at runtime on a real device, where it is expensive to find.
      expect(unit).toMatch(/^ca-app-pub-1548414855954305\/\d+$/);
    }
  });

  it('asks for nothing on a platform with no unit of its own', () => {
    expect(interstitialAdUnitId('web', true)).toBeNull();
    expect(interstitialAdUnitId('web', false)).toBeNull();
  });
});

describe('the export flow', () => {
  const read = (path: string) => readFile(new URL(`../mobile/${path}`, import.meta.url), 'utf8');

  it('requests during the encode and presents after the result', async () => {
    const app = await read('App.tsx');
    // Requested while the user is already waiting, or there is nothing to show
    // when the wait ends. Stated as an order rather than a proximity: what
    // matters is that it sits between the export starting and the encoder being
    // handed the work, not how many lines away it happens to be.
    const running = app.indexOf("setExportState({ kind: 'running' })");
    const prepare = app.indexOf('prepareExportAd();');
    const encoding = app.indexOf('await exportTimeline(');
    expect(running).toBeGreaterThan(-1);
    expect(prepare, 'the ad is requested after the export starts').toBeGreaterThan(running);
    expect(prepare, 'and before the encoder is handed the work').toBeLessThan(encoding);
    // Presented after the result is on screen, never in front of the action.
    expect(app).toMatch(/setExportState\(\s*\n?\s*delivery\.ok[\s\S]*?showExportAd\(delivery\.ok\)/);
    expect(app).not.toMatch(/showExportAd\([^)]*\);[\s\S]{0,80}await exportTimeline/);
  });

  it('releases an ad loaded for a moment that did not arrive', async () => {
    const ad = await read('src/lib/exportAd.ts');
    expect(ad).toContain('if (!exportSucceeded) forget();');
    // An interstitial instance is single-use: showing a closed one does nothing,
    // silently, which reads as "the ad stopped working after the first time".
    expect(ad).toMatch(/CLOSED[\s\S]{0,260}forget\(\)/);
  });

  it('waits for the user to come back rather than sampling the moment', async () => {
    // Delivery on Android goes through a share sheet, which is another
    // activity — so at the instant the delivery promise resolves the app is
    // still `background`, and a foreground check taken right then refused every
    // single time. Running it was the only way to find that: the guard was
    // right and its timing was wrong.
    const ad = await read('src/lib/exportAd.ts');
    expect(ad).toContain('const appActive = exportSucceeded ? await whenForeground() : false;');
    expect(ad).toContain("AppState.addEventListener('change'");
    // Bounded, or an ad arrives detached from the export that earned it.
    expect(ad).toContain('RETURN_WINDOW_MS');
    expect(ad).toMatch(/setTimeout\(\(\) => settle\(false\), RETURN_WINDOW_MS\)/);
  });

  it('checks consent before the request rather than before the presentation', async () => {
    const ad = await read('src/lib/exportAd.ts');
    expect(ad).toMatch(/await ensureAdsReady\(sdk\)[\s\S]{0,200}createForAdRequest/);
  });
});
