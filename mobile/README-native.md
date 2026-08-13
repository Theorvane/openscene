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

Remember to delete `ios/` and `android/` afterwards. They are build output.
