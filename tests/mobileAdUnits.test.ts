import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import { bannerAdUnitId } from '../mobile/src/lib/ads';

/**
 * Which ad unit a build is allowed to ask for.
 *
 * Google requires test ads during development, and an impression or a click
 * from a developer's own device is what gets an AdMob account suspended. That
 * makes "never request a live unit in development" the one rule here worth a
 * test — the rest of the integration cannot be exercised without the native SDK.
 */

const LIVE_IOS = 'ca-app-pub-1548414855954305/6959838161';
const LIVE_ANDROID = 'ca-app-pub-1548414855954305/9606182809';

describe('banner ad units', () => {
  it('never hands a development build a live unit', () => {
    for (const platform of ['ios', 'android'] as const) {
      const unit = bannerAdUnitId(platform, true);
      expect(unit, `${platform} must use a test unit in development`).not.toBe(LIVE_IOS);
      expect(unit).not.toBe(LIVE_ANDROID);
      // Google's test units all sit under this publisher id.
      expect(unit).toMatch(/^ca-app-pub-3940256099942544\//);
    }
  });

  it('uses the platform own live unit in a production build', () => {
    expect(bannerAdUnitId('ios', false)).toBe(LIVE_IOS);
    expect(bannerAdUnitId('android', false)).toBe(LIVE_ANDROID);
  });

  it('asks for nothing on a platform with no unit of its own', () => {
    // A unit does not serve outside the platform it was created for, so there
    // is no sensible fallback — better to show no banner than someone else's.
    expect(bannerAdUnitId('web', false)).toBeNull();
    expect(bannerAdUnitId('web', true)).toBeNull();
  });

  it('carries both app ids, and does not confuse them with the units', async () => {
    const config = JSON.parse(await readFile(new URL('../mobile/app.json', import.meta.url), 'utf8'));
    const entry = config.expo.plugins.find(
      (plugin: unknown) => Array.isArray(plugin) && plugin[0] === 'react-native-google-mobile-ads'
    );

    expect(entry, 'the config plugin must be registered or the SDK crashes on launch').toBeDefined();
    // An app id uses `~`; a unit uses `/`. Swapping them is the classic mistake
    // and it fails at runtime on a real device, where it is expensive to find.
    expect(entry[1].iosAppId).toBe('ca-app-pub-1548414855954305~2877122921');
    expect(entry[1].androidAppId).toBe('ca-app-pub-1548414855954305~3232346149');
    expect(entry[1].iosAppId).toContain('~');
    expect(entry[1].androidAppId).toContain('~');
  });

  it('asks React Native whether the SDK is there before touching the SDK', async () => {
    // Requiring it and catching does not work, which cost two red screens to
    // learn: the package's entry registers its TurboModules eagerly with
    // `getEnforcing`, the throw escapes a `try` around the `require`, and
    // probing the returned object only moves the failure a line later.
    // `TurboModuleRegistry.get` returns null instead of throwing and belongs to
    // React Native, so the question is answered before any of the SDK loads.
    const banner = await readFile(new URL('../mobile/src/components/AdBanner.tsx', import.meta.url), 'utf8');

    expect(banner).not.toMatch(/^import .*from 'react-native-google-mobile-ads';$/m);
    expect(banner).toContain("TurboModuleRegistry.get('RNGoogleMobileAdsModule')");
    expect(banner).toContain('const ads = hasAdsNativeModule() ? loadAds() : null;');
    expect(banner).toContain('if (ads === null || unitId === null || failed || keyboardUp) return null;');
  });

  it('keeps the banner off the tab bar and out of the keyboard', async () => {
    // AdMob's policies are specific about ads a user may tap by accident, and
    // the tab bar below is five 44pt targets.
    const banner = await readFile(new URL('../mobile/src/components/AdBanner.tsx', import.meta.url), 'utf8');
    expect(banner).toContain('borderTopWidth: 1');
    expect(banner).toContain("Keyboard.addListener('keyboardDidShow'");

    // Above the bar, never over the content.
    const app = await readFile(new URL('../mobile/App.tsx', import.meta.url), 'utf8');
    expect(app).toMatch(/<AdBanner \/>[\s\S]{0,200}accessibilityRole="tablist"/);
  });
});
