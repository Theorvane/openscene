# Running with the native export module

`mobile/modules/video-export` is a local Expo module. Expo Go cannot load it — it only carries the modules baked into its own binary — so export is disabled there, with the reason shown on screen. To exercise it you need a development build.

```bash
cd mobile
npx expo prebuild --platform ios
cd ios && LANG=en_US.UTF-8 pod install
cd .. && npx expo run:ios
```

## The locale is not optional

`pod install` fails with

```
Unicode Normalization not appropriate for ASCII-8BIT (Encoding::CompatibilityError)
```

when `LANG` and `LC_ALL` are unset. CocoaPods calls `unicode_normalize` on the installation path, and without a UTF-8 locale that path is `ASCII-8BIT`. This machine had both unset, so `expo prebuild` appeared to succeed while its `pod install` step had died. Setting `LANG=en_US.UTF-8` is the whole fix.

## Confirming the module is linked

`ios/Podfile.lock` should contain:

```
- VideoExport (1.0.0)
- VideoExport (from `../modules/video-export/ios`)
```

and the editor's export note should read "Export renders with AVFoundation" rather than "Export needs a development build". That note is driven by `requireOptionalNativeModule`, so it is a direct report of whether the native side resolved.

`ios/` and `android/` are gitignored, as Expo's continuous-native-generation flow expects — they are regenerated from config and never edited by hand.

# The LevelPlay banner

Ads are mediated by **Unity LevelPlay** (formerly ironSource) through
`ironsource-mediation`. AdMob and `react-native-google-mobile-ads` are gone
entirely. LevelPlay is the mediation SDK; the demand comes from ironSource's own
network plus four adapters — Unity Ads, AppLovin, Meta Audience Network and
Pangle — wired in by `plugins/withLevelPlayMediation.js`.

Like the export module it is native, so Expo Go can neither show an ad nor be
asked for one.

## There is no test ad unit, and that changes the rule

AdMob publishes always-fill test ids, so the old rule was "never a live unit in a
development build". LevelPlay publishes none: every LevelPlay ad unit is real
mediated inventory whoever asks for it, and an impression or a click from a
developer's own device is invalid traffic — which is what suspends a publisher
account.

So `src/lib/ads.ts` returns **null in development**, for both placements, on
every platform — which means both placements are empty in a dev build, and an
integration that works looks exactly like one that does not.

LevelPlay's Test Suite is what tells them apart. It serves from the dashboard
rather than from live inventory, lists every configured network with whether its
adapter is actually in this binary, and loads a test ad per placement. It is
reachable from **Settings → Ad mediation → Test suite**, behind `__DEV__` so it
compiles out of a store build rather than merely being hidden in one.

No extra dependency ships for it: on Android `TestSuiteActivity` is inside
`mediation-sdk` and declared in that AAR's own manifest, and on iOS
`launchTestSuite` is on `LevelPlay` in `IronSourceSDK`. Both were checked against
the artifacts this project resolves.

**The Test Suite is opted into with metadata, before `init`.** Without it,
`launchTestSuite()` is refused:

```
E LevelPlaySDK: API: TestSuite cannot be launched,
                Please contact your account manager to enable it
```

That message is a leftover from the SDK's beta and sends you to the wrong place:
nothing is granted by an account manager. The flag is
`setMetaData('is_test_suite', ['enable'])`, and the order is the whole of it —
init is what reads the metadata, so setting it afterwards produces exactly the
same refusal:

```
setMetaData('is_test_suite', ['enable'])  →  init()  →  onInitSuccess  →  launchTestSuite()
```

`ensureAdsReady` does this in `__DEV__` builds only. The refusal never reaches
the bridge either — `launchTestSuite()` resolves as if it worked — so a wrong
order shows up as a Settings row saying "Opened" with nothing on screen.

Once it opens, nothing appears in it until the dashboard has the networks
configured — a network with no placement set up shows as unavailable even when
its adapter did make it into the binary, which is the distinction worth reading
carefully.

## What the Test Suite showed on an emulator

Worth writing down, because two of these are only visible on a device:

- **The Pangle SDK version is a narrow window, and both edges fail identically.**
  `ads-sdk` 6.5.1.2 has no `setAdxId`; `pag-sdk` 7.9 and later dropped
  `setGDPRConsent(int)`. Adapter 4.3.51 calls both, so only 7.1.0.4 … 7.8.6.2
  work. Either mismatch builds, installs, and throws `NoSuchMethodError` inside
  LevelPlay's init, which the SDK catches — the symptom is a network that never
  initialises, with nothing on screen to say so.
- **LevelPlay's ad-quality connector supports none of them.** "ByteDance SDK
  version 7.8.6.2 is not yet supported by the connector", and the same of 7.5.0.5
  and 8.1.0.7. Ad Quality is revenue measurement rather than delivery, so Pangle
  still serves.
- **Unity Ads does not initialise on an emulator**, with
  `reason=gateway_universal, errorCode=PUBLIC_ERROR_CODE_INIT_UNKNOWN`. It is
  passed the LevelPlay app key as its game id, which is what the dashboard
  configuration decides — check that on a real device before reading anything
  into it.
- **Meta's adapter is alive**: it logs a test-device hash at init.
- **Four of the five networks are bidding, not five.** The Test Suite lists
  ironSource (SDK/adapter 8.10.0), Meta (6.21.0 / 4.3.52), Pangle (7.8.6.2 /
  4.3.51) and UnityAds (4.17.0 / 4.3.65) against both ad units. **AppLovin is
  absent** — its adapter is in the binary, but the network has no instance
  configured for this app in the LevelPlay dashboard, so nothing asks it to bid.
  That is a dashboard change, not a code one.
- **Both placements serve.** With the Test Suite's Live/Test switch set to Test,
  the banner unit `hmcgn9ps07dbs3x9` reports "Ad shown successfully" and renders
  a 320×50 creative, and the interstitial unit `9etyh0zw8fg8dgou` loads and plays
  a full-screen video. Switch it to Test before loading: the default is Live, and
  a live impression from a developer's own device is the invalid traffic this
  whole arrangement exists to avoid.

## Why the banner probes React Native rather than the SDK

`requireOptionalNativeModule` is the pattern everywhere else here, and requiring
in a `try` is the pattern `exportComposition` uses. Neither was safe under the
AdMob binding: its entry registered TurboModules eagerly with `getEnforcing`, so
the throw escaped a `try` around the `require`, and inspecting whatever the
require returned only moved the failure a line later. Both were tried; both were
red screens.

`ironsource-mediation` reads `NativeModules` instead, which yields `undefined`
rather than throwing — but `src/lib/adsModule.ts` still asks React Native's own
registry (`NativeModules.LevelPlayMediation`) before requiring the package, so
the answer arrives before any of the SDK loads whatever the package does at
import time. The types are imported with `import type`, which is erased.

## The adapters are pinned to the SDK the plugin pins

`ironsource-mediation@3.2.0` pins LevelPlay **8.10.0** on both platforms
(`com.unity3d.ads-mediation:mediation-sdk:8.10.0`, pod `IronSourceSDK 8.10.0.0`).
The adapters' 5.x line requires LevelPlay 9.x — CocoaPods refuses that outright,
and on Android it resolves to a mismatched pair that fails at runtime rather than
at build time. So the pins in the config plugin are the last of the 4.3.x line,
which is the one built against 8.x, and they move when the plugin moves.

Two more things about Android that are not obvious from the LevelPlay docs:

- The adapter artifacts' POMs are **empty**. Each demand network's own SDK has to
  be declared alongside its adapter, or the adapter reports the network
  unavailable at init — which reads as poor fill rather than as a bug.
- Pangle's global Android SDK is **not on Maven Central**. It comes from
  `https://artifact.bytedance.com/repository/pangle`, which the plugin adds to
  `allprojects.repositories`.

## Confirming the SDK and the adapters are actually linked

`ios/` and `android/` are gitignored and regenerated, so this is a check to run
rather than a state to keep:

```bash
cd mobile
npx expo prebuild --platform android --no-install
grep -c 'ads-mediation:' android/app/build.gradle          # four adapters
grep -c 'artifact.bytedance.com' android/build.gradle      # one repository

npx expo prebuild --platform ios --no-install
grep -c 'IronSource.*Adapter' ios/Podfile                  # four pods
grep -c skadnetwork ios/*/Info.plist                       # seven identifiers
```

Running `expo prebuild` twice must not double any of those counts — the plugin
writes a marker comment into each generated file and skips a file that has it.

`pod install` resolves this set cleanly and pins `IronSourceSDK 8.10.0.0`, with
one warning worth knowing about rather than fixing:

```
Can't merge user_target_xcconfig for pod targets: ["FBAudienceNetwork",
"IronSourceAdQualitySDK"]. Singular build setting
EXCLUDED_ARCHS[sdk=iphonesimulator*] has different values.
```

The two disagree about which dead architectures to exclude from a simulator
build — `i386` against `arm64e armv7 armv7s` — so CocoaPods applies neither. None
of those is built by a current Xcode, and `arm64` is excluded by neither, so the
simulator build is unaffected. It is noise, not a broken pod.

The SKAdNetwork identifiers come from Unity's LevelPlay SKAdNetwork ID manager
(`https://docs.unity.com/en-us/grow/levelplay/sdk/ios/skadnetwork-id-manager`),
read on 2026-08-22. They are the networks allowed to be credited with a
conversion from this app, so the list belongs to Unity and not to us: when the
mediated networks change, re-copy it rather than editing entries by hand. An
invented identifier is worse than a missing one — it claims an attribution
relationship that does not exist.

That the binding itself is linked is worth checking separately, because it is
resolved at build time rather than written into a file:

```bash
npx expo-modules-autolinking react-native-config --platform android --json \
  | grep -c ironsource-mediation
```

Remember to delete `ios/` and `android/` afterwards. They are build output.

## The plugin needs a patch to build at all on RN 0.86

`ironsource-mediation@3.2.0` is built against React Native 0.73, and its
`IronSourceMediationModule.kt` does not compile against 0.86: React Native
converted `ReactContextBaseJavaModule` to Kotlin, where `getCurrentActivity()`
is a function rather than a Java getter, so Kotlin's synthetic-property access —
`currentActivity` — is no longer allowed. Ninety-nine errors, one cause.

`patches/ironsource-mediation+3.2.0.patch` replaces `currentActivity?.` with
`getCurrentActivity()?.` in that file, applied by `patch-package` from
`postinstall`. It touches only the legacy ironSource API module, which nothing
here calls; the LevelPlay files compile as they are. Drop the patch when Unity
ships a plugin built for the New Architecture.

## Still unproven: the app's own banner view

Both placements serve — through the Test Suite, which renders them with its own
views. What that does not exercise is `AdBanner`, which mounts
`LevelPlayBannerAdView`: `ironsource-mediation` registers it through
`requireNativeComponent`, a legacy view manager, and this app is on 0.86 with the
New Architecture, where legacy view managers go through the interop layer. The
failure mode is a banner that never appears rather than a build error, so it
needs a look on a build that requests one.
