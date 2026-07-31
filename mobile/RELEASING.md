# Releasing OpenScene to the stores

What the repository already sets, and what only you can.

Identity is fixed in `app.json` and regenerates from it — `android/` and `ios/`
are build output, not source, so never edit them by hand. Anything that must
survive `expo prebuild` belongs in a config plugin, as the release signing does.

| | value |
| --- | --- |
| Display name | OpenScene |
| iOS bundle id / Android applicationId | `com.sloki9637.openscene` |
| Version | `0.3.0` (`expo.version`) |
| iOS build number | `expo.ios.buildNumber` |
| Android version code | `expo.android.versionCode` |

Both stores reject a build whose build number is not higher than the last one
you uploaded, **even for a rejected submission**. Raise `buildNumber` and
`versionCode` on every upload, not on every release.

## Permissions

The app asks for three, and the manifest is pruned to exactly those:

- `INTERNET` — generation calls the providers you connected
- `READ_MEDIA_VIDEO`, `READ_MEDIA_VISUAL_USER_SELECTED` — importing a clip

`RECORD_AUDIO`, `VIBRATE`, `SYSTEM_ALERT_WINDOW`, the image and audio media
permissions and legacy external storage all arrive from transitive libraries and
are removed in `expo.android.blockedPermissions`. Reviewers ask about
permissions an app does not visibly use, and every extra one is another row to
justify in Data Safety.

## Android

### The signing key is yours to make

Play requires a real key, and the repository holds no secrets. Generate one and
keep it somewhere you will still have in five years — losing it means you cannot
update the listing:

```bash
keytool -genkeypair -v -keystore openscene-release.jks \
  -alias openscene -keyalg RSA -keysize 2048 -validity 10000
```

Then put the four values in `~/.gradle/gradle.properties` — outside the
repository, and never in it:

```properties
OPENSCENE_STORE_FILE=/absolute/path/to/openscene-release.jks
OPENSCENE_STORE_PASSWORD=…
OPENSCENE_KEY_ALIAS=openscene
OPENSCENE_KEY_PASSWORD=…
```

`plugins/withReleaseSigning.js` reads them. When they are absent the release
build falls back to the debug key, so a local build still works for testing and
only a real submission needs the keystore.

### Build

```bash
cd mobile
npx expo prebuild --platform android
cd android && ./gradlew bundleRelease
```

The AAB lands in `android/app/build/outputs/bundle/release/`. Play takes an
**AAB**, not an APK; `assembleRelease` produces an APK, which is for sideloading
and direct distribution.

## iOS

Needs an Apple Developer account, a distribution certificate and a provisioning
profile for `com.sloki9637.openscene` — all created in your own account, none of
which this repository can or should hold.

```bash
cd mobile
npx expo prebuild --platform ios
open ios/OpenScene.xcworkspace
```

Then Product → Archive → Distribute App. `ITSAppUsesNonExemptEncryption` is
already declared `false`, which skips the export-compliance question on every
upload — correct here because the app uses only standard TLS and the system
keychain. Verify that claim yourself before you rely on it; it is a legal
declaration in your name, not ours.

## What reviewers will ask about

**The app talks to third-party AI providers.** Only ones the user connects with
their own key, only when they ask, and the key is held in Keychain/Keystore.
Both stores want that stated in the privacy questionnaire and in a privacy
policy you host. Prompts and generated media go to the provider the user chose;
nothing goes anywhere else, and there is no analytics or account.

**Android export does not work yet.** It reports that plainly rather than
failing silently — but a reviewer who taps Export on Android will see it. Either
ship iOS first, or finish the Media3 Transformer work before submitting Android.

**Age rating** — user-supplied prompts reach a generative model, so both stores
treat it as user-generated content. Expect questions about moderation; the
honest answer is that moderation is the provider's, since the app holds no
server of its own.
