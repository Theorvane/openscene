import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import { interstitialAdUnitId } from '../mobile/src/lib/ads';
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
    expect(decideInterstitial({ exportSucceeded: false, unitId: null, adFilled: false, lastShownAt: null, now: 0 }).because).toBe(
      'export-failed'
    );
  });

  it('does not punctuate a working session', () => {
    const first = { ...base, lastShownAt: base.now - 1_000 };
    expect(decideInterstitial(first).because).toBe('too-soon');
    // Someone exporting three cuts in a row is one person working.
    expect(decideInterstitial({ ...base, lastShownAt: base.now - INTERSTITIAL_MIN_GAP_MS + 1 }).because).toBe('too-soon');
    expect(decideInterstitial({ ...base, lastShownAt: base.now - INTERSTITIAL_MIN_GAP_MS }).show).toBe(true);
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

  it('asks for nothing where no live unit exists yet', () => {
    // A banner id does not serve an interstitial request, so there is nothing to
    // borrow. Absent has to read as "no interstitial" rather than as a fallback
    // to some other unit, which would be a request against the wrong placement.
    expect(interstitialAdUnitId('ios', false)).toBeNull();
    expect(interstitialAdUnitId('android', false)).toBeNull();
    expect(interstitialAdUnitId('web', true)).toBeNull();
  });
});

describe('the export flow', () => {
  const read = (path: string) => readFile(new URL(`../mobile/${path}`, import.meta.url), 'utf8');

  it('requests during the encode and presents after the result', async () => {
    const app = await read('App.tsx');
    // Requested while the user is already waiting, or there is nothing to show
    // when the wait ends.
    expect(app).toMatch(/setExportState\(\{ kind: 'running' \}\);[\s\S]{0,300}prepareExportAd\(\);/);
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

  it('checks consent before the request rather than before the presentation', async () => {
    const ad = await read('src/lib/exportAd.ts');
    expect(ad).toMatch(/await ensureAdsReady\(sdk\)[\s\S]{0,200}createForAdRequest/);
  });
});
