import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import { bannerAdUnitId, interstitialAdUnitId, levelPlayAppKey } from '../mobile/src/lib/ads';

/**
 * Which ad unit a build is allowed to ask for, now that Unity LevelPlay mediates
 * rather than AdMob.
 *
 * The rule changed shape with the network. AdMob publishes always-fill test units
 * and the rule was "never a live unit in development"; LevelPlay publishes none,
 * because every LevelPlay unit is real mediated inventory whoever asks. So the
 * rule here is stronger — a development build asks for nothing at all — and it is
 * still the one thing worth a test, because an impression from a developer's own
 * device is invalid traffic and invalid traffic is what suspends an account.
 */

describe('LevelPlay ad units', () => {
  it('asks for nothing at all in development', () => {
    // There is no test unit to hand back instead. This is the whole rule.
    for (const platform of ['ios', 'android', 'web'] as const) {
      expect(bannerAdUnitId(platform, true), `${platform} must request no banner in development`).toBeNull();
      expect(interstitialAdUnitId(platform, true), `${platform} must request no interstitial in development`).toBeNull();
    }
  });

  it('asks for nothing on a platform with no unit of its own', () => {
    // A unit belongs to one dashboard app on one platform, so there is no
    // sensible fallback — better to show no banner than someone else's.
    expect(bannerAdUnitId('web', false)).toBeNull();
    expect(interstitialAdUnitId('web', false)).toBeNull();
    expect(levelPlayAppKey('web')).toBeNull();
  });

  it('uses the platform own app key and units in a production build', () => {
    // Two dashboard apps, one per store listing, and the keys differ by three
    // characters in the middle. Swapping them initialises against the other
    // store's app, which fails only on a device and looks like zero fill.
    expect(levelPlayAppKey('ios')).toBe('27bc507ad');
    expect(levelPlayAppKey('android')).toBe('27bc54135');
    expect(bannerAdUnitId('ios', false)).toBe('65tx5nxosvpopb4b');
    expect(bannerAdUnitId('android', false)).toBe('hmcgn9ps07dbs3x9');
    expect(interstitialAdUnitId('ios', false)).toBe('ii71gp04gfktnj8i');
    expect(interstitialAdUnitId('android', false)).toBe('9etyh0zw8fg8dgou');
  });

  it('keeps each placement on its own unit', () => {
    // Four live units across two placements and two platforms. An interstitial
    // served into a banner slot, or one platform's unit asked for from the
    // other, is a policy violation rather than a rendering bug.
    const units = [
      bannerAdUnitId('ios', false),
      bannerAdUnitId('android', false),
      interstitialAdUnitId('ios', false),
      interstitialAdUnitId('android', false)
    ];
    expect(new Set(units).size).toBe(4);
    expect(levelPlayAppKey('ios')).not.toBe(levelPlayAppKey('android'));
    // A LevelPlay unit id is an opaque token, not the `ca-app-pub-…/…` shape the
    // AdMob ids had; anything carrying a slash is a leftover from that account.
    for (const unit of units) expect(unit).toMatch(/^[a-z0-9]+$/);
  });

  it('holds no AdMob identifier anywhere in the mobile app', async () => {
    // AdMob is gone rather than dormant. A left-behind `ca-app-pub-…` is an id
    // pointing at an account this app no longer initialises, and the next person
    // reading it would reasonably think it still serves.
    const files = [
      'src/lib/ads.ts',
      'src/lib/adsModule.ts',
      'src/lib/exportAd.ts',
      'src/components/AdBanner.tsx',
      'app.json',
      'package.json'
    ];
    for (const file of files) {
      const contents = await readFile(new URL(`../mobile/${file}`, import.meta.url), 'utf8');
      expect(contents, `${file} still carries an AdMob id`).not.toMatch(/ca-app-pub-/);
      expect(contents, `${file} still refers to the AdMob binding`).not.toContain('react-native-google-mobile-ads');
    }
  });

  it('names the publisher, and takes the version from the config', async () => {
    // An app carrying ads is a published thing rather than a personal build, and
    // both the stores and the mediation account expect a publisher a user can
    // identify.
    const about = await readFile(new URL('../mobile/src/lib/about.ts', import.meta.url), 'utf8');
    expect(about).toContain("DEVELOPER_NAME = 'sloki9637'");
    expect(about).toContain("DEVELOPER_SITE = 'www.sloki9637.com'");
    // A version written out twice is a version that disagrees with itself at the
    // worst moment — a bug report against a number no build ever had.
    expect(about).toContain('appConfig.expo.version');
    expect(about).not.toMatch(/APP_VERSION[^=]*= '[\d.]+'/);
  });

  it('can reach the privacy policy from inside the app', async () => {
    // Serving ads requires one — LevelPlay asks for the URL and the stores ask
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
});

describe('the native side', () => {
  const readMobile = (file: string) => readFile(new URL(`../mobile/${file}`, import.meta.url), 'utf8');

  it('registers the plugin that wires the adapters in', async () => {
    // `ironsource-mediation` autolinks the LevelPlay SDK and nothing else. With
    // no adapters the app builds, initialises, and quietly serves ironSource's
    // own inventory only — which looks like weak fill rather than a broken build.
    const config = JSON.parse(await readMobile('app.json'));
    expect(config.expo.plugins).toContain('./plugins/withLevelPlayMediation');
    const packageJson = JSON.parse(await readMobile('package.json'));
    expect(packageJson.dependencies['ironsource-mediation']).toBeDefined();
    expect(packageJson.dependencies['react-native-google-mobile-ads']).toBeUndefined();
  });

  it('carries an adapter for every network that is meant to bid', async () => {
    const plugin = await readMobile('plugins/withLevelPlayMediation.js');
    for (const adapter of ['unityads-adapter', 'applovin-adapter', 'facebook-adapter', 'pangle-adapter']) {
      expect(plugin, `${adapter} is missing on Android`).toContain(adapter);
    }
    for (const pod of [
      'IronSourceUnityAdsAdapter',
      'IronSourceAppLovinAdapter',
      'IronSourceFacebookAdapter',
      'IronSourcePangleAdapter'
    ]) {
      expect(plugin, `${pod} is missing on iOS`).toContain(pod);
    }
    // Android adapter POMs are empty, so each network's own SDK has to be named
    // too. Without it the adapter reports the network unavailable at init.
    for (const sdk of [
      'com.unity3d.ads:unity-ads',
      'com.applovin:applovin-sdk',
      'com.facebook.android:audience-network-sdk',
      'com.pangle.global:pag-sdk'
    ]) {
      expect(plugin, `${sdk} is missing on Android`).toContain(sdk);
    }
    // And Pangle's SDK is not on Maven Central, which fails as "could not find
    // com.pangle.global:pag-sdk" long after the adapter itself resolved.
    expect(plugin).toContain('artifact.bytedance.com/repository/pangle');
    // Editing a generated file twice is the failure mode of a config plugin, and
    // `expo prebuild` runs more than once.
    expect(plugin).toMatch(/includes\(MARKER\)/);
  });

  it('carries the SKAdNetwork identifiers, in the shape Apple requires', async () => {
    // Without these an ad network cannot be credited with a conversion on
    // iOS 14+, so attribution fails — which shows up as lower fill and revenue
    // rather than as an error. Taken from Unity's LevelPlay SKAdNetwork ID
    // manager on 2026-08-22; a wrong or invented entry is worse than an absent
    // one, because it claims an attribution relationship that does not exist.
    const config = JSON.parse(await readMobile('app.json'));
    const items: readonly { SKAdNetworkIdentifier: string }[] = config.expo.ios.infoPlist.SKAdNetworkItems;

    expect(items.length).toBeGreaterThan(0);
    const ids = items.map((item) => item.SKAdNetworkIdentifier);
    expect(new Set(ids).size, 'duplicates are silently ignored and hide a bad paste').toBe(ids.length);
    for (const id of ids) {
      expect(id, `${id} is not an SKAdNetwork identifier`).toMatch(/^[a-z0-9]{10}\.skadnetwork$/);
    }
    // One per network that can bid here. If the list were ever replaced by
    // something else's, these are the entries that would go missing.
    expect(ids, 'LevelPlay itself').toContain('su67r6k2v3.skadnetwork');
    expect(ids, 'Unity Ads').toContain('4dzt52r2t5.skadnetwork');
    expect(ids, 'AppLovin').toContain('ludvb6z3bs.skadnetwork');
    expect(ids, 'Meta Audience Network').toContain('v9wttpbfk9.skadnetwork');
    expect(ids, 'Pangle').toContain('22mmun2rn5.skadnetwork');
    // Google's own id has no business here any more: AdMob is not mediated.
    expect(ids).not.toContain('cstr6suwn9.skadnetwork');
  });

  it('can open the test suite, and only from a development build', async () => {
    // Development requests no live ad, so both placements stay empty and an
    // integration that works is indistinguishable from one that does not. The
    // Test Suite is the only way to tell them apart — and it has to be reachable
    // from the app, or it may as well not ship.
    const seam = await readMobile('src/lib/adsModule.ts');
    expect(seam).toContain('launchTestSuite()');
    // Opted into with metadata, and *before* init — init is what reads it, so
    // the same call afterwards is refused with "contact your account manager",
    // a message left over from the SDK's beta that sends you somewhere else
    // entirely. Order is the whole of this one.
    // Stated as an order rather than a proximity: what matters is which call
    // happens first, not how many lines of comment sit between them.
    expect(seam).toContain("setMetaData('is_test_suite', ['enable'])");
    expect(seam.indexOf("setMetaData('is_test_suite'")).toBeLessThan(seam.indexOf('LevelPlay.init('));
    // Initialised first: the Test Suite is a LevelPlay screen and needs the SDK
    // up before it can list anything.
    expect(seam).toMatch(/await ensureAdsReady\(ads\)[\s\S]{0,200}launchTestSuite\(\)/);

    const settings = await readMobile('src/screens/SettingsScreen.tsx');
    expect(settings).toContain('openAdTestSuite()');
    // Behind `__DEV__` so it is compiled out of a store build rather than merely
    // hidden in one: a user who found it would find ads they cannot dismiss on a
    // screen that explains nothing.
    expect(settings).toMatch(/\{__DEV__ && \([\s\S]{0,1200}openAdTestSuite\(\)/);
  });

  it('carries the ATS exception the mediated networks need', async () => {
    // Several networks still serve creatives and make tracking calls over plain
    // HTTP; without this they fail silently as no-fill rather than as an error,
    // which is the worst shape this misconfiguration could take. It is an app-wide
    // exception Apple asks to have justified at review — see RELEASING.md — so
    // it is asserted rather than left to whoever edits app.json next.
    const config = JSON.parse(await readMobile('app.json'));
    expect(config.expo.ios.infoPlist.NSAppTransportSecurity.NSAllowsArbitraryLoads).toBe(true);
  });

  it('asks React Native whether the SDK is there before touching the SDK', async () => {
    // The lesson survives the change of network even though the mechanism did
    // not: the previous binding registered TurboModules eagerly with
    // `getEnforcing`, so a throw escaped a `try` around the `require` and cost
    // two red screens. Asking React Native's own registry first answers the
    // question before any of the package loads, whatever the package does at
    // import time. The seam is shared, so the lesson is asserted where it lives
    // rather than once per placement.
    const seam = await readMobile('src/lib/adsModule.ts');
    const banner = await readMobile('src/components/AdBanner.tsx');

    // `import type` is erased; a value import is not, and would load the SDK at
    // module-graph time in a client that cannot provide it.
    expect(seam).not.toMatch(/^import (?!type)[^;]*from 'ironsource-mediation';$/m);
    expect(seam).toContain('NativeModules.LevelPlayMediation != null');
    expect(seam).toContain('if (!hasAdsNativeModule()) return null;');
    expect(banner).toContain('loadAds()');
    expect(banner).toContain('if (ads === null || unitId === null || !ready || failed || keyboardUp) return null;');
  });

  it('sets the privacy signals and initialises before it ever requests an ad', async () => {
    // Removing AdMob removed Google's UMP with it, so there is no consent form
    // any more. What replaces it is the conservative default: consent declared
    // not given, so every mediated network serves non-personalised ads, and the
    // CCPA do-not-sell signal set for the same reason. Requesting before init is
    // not merely out of order — LevelPlay drops the request.
    const seam = await readMobile('src/lib/adsModule.ts');
    const banner = await readMobile('src/components/AdBanner.tsx');
    const exportAd = await readMobile('src/lib/exportAd.ts');

    expect(seam).toContain('setConsent(false)');
    expect(seam).toContain("setMetaData('do_not_sell', ['true'])");
    // And it fails closed. These two are the entire privacy posture; if either
    // does not apply, the networks fall back to their own defaults — which is
    // personalised inventory with no consent behind it, served under answers the
    // store forms and the privacy policy both deny, with nothing on screen
    // looking any different. No signals, no init.
    expect(seam).toMatch(/setMetaData\('do_not_sell'[\s\S]{0,120}\} catch \{[\s\S]{0,600}return false;/);
    expect(seam.indexOf('setConsent(false)')).toBeLessThan(seam.indexOf('LevelPlay.init('));
    // The gate is on the render, not merely in the effect.
    expect(banner).toContain('await ensureAdsReady(ads)');
    expect(banner).toContain('!ready || failed || keyboardUp) return null;');
    expect(exportAd).toMatch(/await ensureAdsReady\(sdk\)[\s\S]{0,300}new sdk\.LevelPlayInterstitialAd/);
  });

  it('treats a no-fill as a moment rather than the rest of the session', async () => {
    // Collapsing is right; latching it for the life of the screen turned one
    // bad minute into a session with no ads at all.
    const banner = await readMobile('src/components/AdBanner.tsx');
    expect(banner).toContain('setTimeout(() => setFailed(false), RETRY_AFTER_MS)');
  });

  it('gives the banner a size of its own', async () => {
    // A native view with no intrinsic size measures zero in React Native's
    // layout, and an ad that is present, paid for and invisible is an invalid
    // impression rather than a rendering nit.
    const banner = await readMobile('src/components/AdBanner.tsx');
    expect(banner).toContain('width: BANNER_WIDTH');
    expect(banner).toContain('height: BANNER_HEIGHT');
  });

  it('keeps the banner off the tab bar and out of the keyboard', async () => {
    // Every mediated network's policies are specific about ads a user may tap by
    // accident, and the tab bar below is five 44pt targets.
    const banner = await readMobile('src/components/AdBanner.tsx');
    expect(banner).toContain('borderTopWidth: 1');
    expect(banner).toContain("Keyboard.addListener('keyboardDidShow'");

    // Above the bar, never over the content.
    const app = await readMobile('App.tsx');
    expect(app).toMatch(/<AdBanner \/>[\s\S]{0,200}accessibilityRole="tablist"/);
  });
});
