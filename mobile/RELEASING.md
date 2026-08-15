# Releasing OpenScene to the stores

What the repository already sets, and what only you can.

Identity is fixed in `app.json` and regenerates from it — `android/` and `ios/`
are build output, not source, so never edit them by hand. Anything that must
survive `expo prebuild` belongs in a config plugin, as the release signing does.

| | value |
| --- | --- |
| Display name | OpenScene |
| iOS bundle id / Android applicationId | `com.sloki9637.openscene` |
| Version | `0.4.0` (`expo.version`) |
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

## Store distribution on main releases

The **release** workflow is the only store-distribution trigger. It runs when
an unreleased version is promoted to `main`, after the release verification and
desktop packaging jobs finish. It calls the iOS and Android distribution
workflows; they cannot be run manually. A push to `main` with an already tagged
version skips all release and store-distribution work.

The iOS job builds an IPA and uploads it to App Store Connect. It never submits
an app for review: that remains an explicit App Store Connect action after build
processing and metadata review. The Android job uploads the signed AAB to the
Google Play **production** track with status `completed` — live to every user
the moment it lands.

**The Android job runs after the iOS one, not beside it.** They are not equally
reversible, and the irreversible step should be the last one that can fail: Play
must never publish a release that iOS could not. Run in parallel, an iOS failure
after Play had already published left the release shipped and untagged, and a
later push to `main` re-uploaded the same `versionCode`, which Play rejects.

One smaller gap remains, which ordering cannot close. If Play publishes and the
tagging job then fails, the release is live and unrecorded. Re-running the
workflow is safe for the tag — it asks origin before pushing — but it re-enters
the store jobs, and Play refuses a `versionCode` it already has. If that happens,
raise `version`, `buildNumber` and `versionCode` and release again; the published
build is fine, only the record of it is missing.

Create the `app-store-production` GitHub Environment, restrict it to the `main`
branch, and require a reviewer before deploying. Store the following values as
environment configuration (not in the repository):

- Variables: `APPLE_TEAM_ID` (`5H9F8F82WT`) and `APP_STORE_PROFILE_NAME`
  (`macbook`).
- Secrets: `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_PRIVATE_KEY`,
  `APPLE_DISTRIBUTION_CERTIFICATE_BASE64`,
  `APPLE_DISTRIBUTION_CERTIFICATE_PASSWORD`, and
  `APP_STORE_PROVISIONING_PROFILE_BASE64`.

`ASC_PRIVATE_KEY` is the complete content of the downloaded App Store Connect
`.p8` file. The two `*_BASE64` secrets are base64-encoded copies of the signing
certificate `.p12` and the App Store provisioning profile respectively. Never
commit any of these files or their decoded values.

### Google Play automation

Create the `play-store-production` GitHub Environment, restrict it to the
`main` branch, and require a reviewer before deploying. Store the following
values as environment configuration (not in the repository):

- Variable: `ANDROID_PACKAGE_NAME` (`com.sloki9637.openscene`).
- Secrets: `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`,
  `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`, and
  `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON`.

`ANDROID_KEYSTORE_BASE64` is the base64-encoded release keystore. The Google
Play service account must have access to the OpenScene app in Play Console and
the Google Play Android Developer API must be enabled for its Google Cloud
project. Never commit the keystore, Gradle properties, or service-account JSON.

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
Both stores want that stated in the privacy questionnaire and in the privacy
policy, which is published at `https://www.sloki9637.com/privacy` and linked from
Settings. Prompts and generated media go to the provider the user chose; nothing
else about the user's editing leaves the device, and there is no account.

**The app shows ads, and that changes the privacy answers.** The Google Mobile
Ads SDK is in the binary and reports device identifiers to Google. Both stores
ask about this directly and the answers are no longer "none":

- **Data Safety / App Privacy** must declare device or other identifiers,
  collected by a third party, used for advertising. Declaring nothing here is
  the mismatch reviewers look for, and it is checked against the SDKs in the
  binary rather than against what the form says.
- **iOS** lists the SKAdNetwork identifiers Google publishes; they are in
  `app.json` and reach `Info.plist` through the config plugin.
- **App Tracking Transparency is not implemented**, deliberately. Without it the
  SDK serves non-personalised ads, which needs no ATT prompt. Adding
  personalised ads means adding the prompt and the Info.plist string first.
- **Consent** is gathered through Google's UMP before any ad is requested, and
  the banner does not render until `canRequestAds` is true.

**Ads have not been seen to run.** Expo Go cannot load the SDK, so the banner,
the consent flow and the SDK initialisation have only ever been exercised as
code. A development build must show a test banner before a store build ships
one — a release that reaches users with a silently broken banner earns nothing
and still declares ad collection.

**There are two placements, and the interstitial is the one policy is strict
about.** Reviewed against the AdMob programme policies; what the implementation
does, and why:

| Policy | What the app does |
| --- | --- |
| No ad in front of a user-initiated action | The interstitial is presented after the export has produced a file and the result is on screen — never on the Export tap |
| No ad over loading content | Nothing is presented while the encoder runs |
| No ad on an unsuccessful action | A failed export shows nothing and releases the ad loaded for it |
| No impression the user cannot see | Refused unless `AppState` is `active`; an export can run for minutes and people put the phone down |
| Not repeatedly, in succession | One every five minutes at most |
| Consent before the request | UMP `canRequestAds` gates the *request*, not the presentation |
| Never a live unit in a test build | Resolved in `src/lib/ads.ts`, not at the call site |
| No accidental clicks | The banner has its own block and a rule above it, clear of the tab bar's five 44pt targets, and is hidden while the keyboard is up |
| Publisher identifiable, policy reachable | Developer, site, contact, terms and privacy in Settings |

Both interstitial units are live: `.../3993164988` on iOS, `.../9641715519` on
Android. Four live units across two placements, and each one only ever serves the
placement it was made for — an interstitial id in a banner slot, or the reverse,
is a policy violation rather than a rendering bug, so a test asserts all four are
distinct and correctly shaped.

**Android export is implemented but unverified.** The Media3 Transformer path
is written, compiles, and installs; no export has been seen to produce a file.
Two attempts on an emulator ended with the emulator itself dying, which is a
resource problem rather than evidence either way — but it is not evidence that
it works.

Run one on a real device before submitting Android: import a clip, tap Export,
and confirm a playable file arrives in the photo library. If it does not, set
`isSupported` back to `false` in `VideoExportModule.kt` so the app says so
plainly rather than handing the user a path to nothing, and ship iOS first.

Overlapping video layers are refused by name on Android — the plan flattens
every video track into one list, and compositing two sequences is work that is
not done. A single video track, which is what the app creates by default,
exports as one sequence.

**Age rating** — user-supplied prompts reach a generative model, so both stores
treat it as user-generated content. Expect questions about moderation; the
honest answer is that moderation is the provider's, since the app holds no
server of its own.
