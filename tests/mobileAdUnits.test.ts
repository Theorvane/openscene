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

  it('names the publisher, and takes the version from the config', async () => {
    // An app carrying ads is a published thing rather than a personal build, and
    // both the stores and AdMob expect a publisher a user can identify.
    const about = await readFile(new URL('../mobile/src/lib/about.ts', import.meta.url), 'utf8');
    expect(about).toContain("DEVELOPER_NAME = 'sloki9637'");
    expect(about).toContain("DEVELOPER_SITE = 'www.sloki9637.com'");
    // A version written out twice is a version that disagrees with itself at the
    // worst moment — a bug report against a number no build ever had.
    expect(about).toContain('appConfig.expo.version');
    expect(about).not.toMatch(/APP_VERSION[^=]*= '[\d.]+'/);
  });

  it('can reach the privacy policy from inside the app', async () => {
    // Serving ads requires one — AdMob asks for the URL and the stores ask
    // again — and it has to be reachable from the app rather than only from a
    // listing page the user never opens.
    const about = await readFile(new URL('../mobile/src/lib/about.ts', import.meta.url), 'utf8');
    expect(about).toContain("PRIVACY_URL = 'https://www.sloki9637.com/privacy'");
    expect(about).toContain("TERMS_URL = 'https://www.sloki9637.com/terms'");

    // Both live in Settings, and both open rather than sitting there as text.
    const settings = await readFile(new URL('../mobile/src/screens/SettingsScreen.tsx', import.meta.url), 'utf8');
    expect(settings).toContain('WebBrowser.openBrowserAsync(PRIVACY_URL)');
    expect(settings).toContain('WebBrowser.openBrowserAsync(TERMS_URL)');

    // And a way to write to the publisher, which the stores also ask for.
    expect(about).toContain("CONTACT_EMAIL = 'inquiry@sloki9637.com'");
    expect(settings).toContain('Linking.openURL(`mailto:${CONTACT_EMAIL}`)');
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

  it('carries the SKAdNetwork identifiers, in the shape Apple requires', async () => {
    // Without these an ad network cannot be credited with a conversion on
    // iOS 14+, so attribution fails — which shows up as lower fill and revenue
    // rather than as an error. Copied from Google's AdMob iOS quick-start; a
    // wrong or invented entry is worse than an absent one, because it claims an
    // attribution relationship that does not exist.
    const config = JSON.parse(await readFile(new URL('../mobile/app.json', import.meta.url), 'utf8'));
    const entry = config.expo.plugins.find(
      (plugin: unknown) => Array.isArray(plugin) && plugin[0] === 'react-native-google-mobile-ads'
    );
    const items: readonly string[] = entry[1].skAdNetworkItems;

    expect(items.length).toBeGreaterThan(40);
    expect(new Set(items).size, 'duplicates are silently ignored and hide a bad paste').toBe(items.length);
    for (const item of items) {
      expect(item, `${item} is not an SKAdNetwork identifier`).toMatch(/^[a-z0-9]{10}\.skadnetwork$/);
    }
    // Google's own network. If the list were ever replaced by something else's,
    // this is the entry that would go missing.
    expect(items).toContain('cstr6suwn9.skadnetwork');
  });

  it('asks React Native whether the SDK is there before touching the SDK', async () => {
    // Requiring it and catching does not work, which cost two red screens to
    // learn: the package's entry registers its TurboModules eagerly with
    // `getEnforcing`, the throw escapes a `try` around the `require`, and
    // probing the returned object only moves the failure a line later.
    // `TurboModuleRegistry.get` returns null instead of throwing and belongs to
    // React Native, so the question is answered before any of the SDK loads.
    // The seam is shared now that a second placement uses it, so the lesson is
    // asserted where it lives rather than once per component.
    const seam = await readFile(new URL('../mobile/src/lib/adsModule.ts', import.meta.url), 'utf8');
    const banner = await readFile(new URL('../mobile/src/components/AdBanner.tsx', import.meta.url), 'utf8');

    expect(seam).not.toMatch(/^import .*from 'react-native-google-mobile-ads';$/m);
    expect(seam).toContain("TurboModuleRegistry.get('RNGoogleMobileAdsModule')");
    expect(seam).toContain('if (!hasAdsNativeModule()) return null;');
    expect(banner).toContain('loadAds()');
    expect(banner).toContain('if (ads === null || unitId === null || !ready || failed || keyboardUp) return null;');
  });

  it('checks consent and initialises before it ever requests an ad', async () => {
    // Google's iOS privacy guidance: "Before requesting ads, use
    // `canRequestAds` to check if you've obtained consent from the user."
    // Requesting first and asking later is the compliance failure, not a
    // rendering one, so nothing on screen would have revealed it.
    const seam = await readFile(new URL('../mobile/src/lib/adsModule.ts', import.meta.url), 'utf8');
    const banner = await readFile(new URL('../mobile/src/components/AdBanner.tsx', import.meta.url), 'utf8');

    expect(seam).toContain('AdsConsent.requestInfoUpdate()');
    expect(seam).toContain('AdsConsent.loadAndShowConsentFormIfRequired()');
    expect(seam).toContain('info.canRequestAds !== true) return false;');
    expect(seam).toContain('MobileAds().initialize()');
    // The gate is on the render, not merely in the effect.
    expect(banner).toContain('await ensureAdsReady(ads)');
    expect(banner).toContain('!ready || failed || keyboardUp) return null;');
  });

  it('treats a no-fill as a moment rather than the rest of the session', async () => {
    // Collapsing is right; latching it for the life of the screen turned one
    // bad minute into a session with no ads at all.
    const banner = await readFile(new URL('../mobile/src/components/AdBanner.tsx', import.meta.url), 'utf8');
    expect(banner).toContain('setTimeout(() => setFailed(false), RETRY_AFTER_MS)');
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
