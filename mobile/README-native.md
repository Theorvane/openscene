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

# The AdMob banner

`react-native-google-mobile-ads` is the maintained AdMob binding for React
Native and what Expo points at; `expo-ads-admob` is gone. Like the export
module it is native, so Expo Go cannot show an ad — but unlike the export
module, it cannot even be *asked* whether it is there.

## Why the banner probes React Native rather than the SDK

`requireOptionalNativeModule` is the pattern everywhere else here, and requiring
in a `try` is the pattern `exportComposition` uses. Neither works for this
package: its entry registers TurboModules eagerly with `getEnforcing`, so the
throw escapes a `try` around the `require`, and inspecting whatever the require
returned only moves the failure a line later. Both were tried; both were red
screens.

`TurboModuleRegistry.get` returns null instead of throwing and belongs to React
Native rather than the package, so `AdBanner` asks it first and never touches
the SDK in a client that lacks it.

## The ads binding is pinned, and why

`react-native-google-mobile-ads` is held at **16.0.0**, not the newest release.
16.4.0 pulls `play-services-ads:25.4.0`, which is compiled with Kotlin 2.3
metadata; this project's Kotlin is 2.1, and a compiler cannot read metadata from
a version newer than itself:

```
Module was compiled with an incompatible version of Kotlin.
The binary version of its metadata is 2.3.0, expected version is 2.1.0.
```

Raising Kotlin instead was tried and is worse. `expo-build-properties`'
`android.kotlinVersion` moves the stdlib to 2.3 but leaves each module compiling
at 2.1, so the build then fails in `react-native-safe-area-context` rather than
in the ads SDK — "the compiler version 2.1.0 can read versions up to 2.2.0".
Kotlin here comes from Expo's version catalog and moves when Expo moves.

16.0.0 pulls `play-services-ads:24.6.0`, which builds. When Expo's Kotlin
reaches 2.3, the binding can go forward again — until then, upgrading it breaks
the Android build outright, which is the sort of thing worth knowing before
spending twenty minutes on a red Gradle log.

## Confirming the SDK is actually linked

`ios/` and `android/` are gitignored and regenerated, so this is a check to run
rather than a state to keep:

```bash
cd mobile
npx expo prebuild --platform android --no-install
grep -A1 APPLICATION_ID android/app/src/main/AndroidManifest.xml

npx expo prebuild --platform ios --no-install
grep -A1 GADApplicationIdentifier ios/*/Info.plist
```

Both should print the app id for that platform — `~3232346149` on Android,
`~2877122921` on iOS. An app id uses `~`; an ad unit uses `/`, and swapping them
fails only on a device.

That the binding itself is linked is worth checking separately, because it is
resolved at build time rather than written into a file:

```bash
npx expo-modules-autolinking react-native-config --platform android --json \
  | grep -c react-native-google-mobile-ads
```

The iOS pod resolves through `RNGoogleMobileAds.podspec`, which depends on
`Google-Mobile-Ads-SDK` — that pod is the Google SDK itself.

On iOS the same prebuild should also show fifty `SKAdNetworkIdentifier` entries:

```bash
grep -c skadnetwork ios/*/Info.plist
```

Those come from Google's AdMob iOS quick-start, copied on 2026-08-13. They are
the networks allowed to be credited with a conversion from this app, so the list
belongs to Google and not to us: when it changes, re-copy it from
`https://developers.google.com/admob/ios/quick-start` rather than editing
entries by hand. An invented identifier is worse than a missing one — it claims
an attribution relationship that does not exist.

Remember to delete `ios/` and `android/` afterwards. They are build output.
