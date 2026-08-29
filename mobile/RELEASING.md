# Releasing OpenScene to the stores

What the repository already sets, and what only you can.

Identity is fixed in `app.json` and regenerates from it — `android/` and `ios/`
are build output, not source, so never edit them by hand. Anything that must
survive `expo prebuild` belongs in a config plugin, as the release signing does.

| | value |
| --- | --- |
| Display name | OpenScene |
| iOS bundle id / Android applicationId | `com.sloki9637.openscene` |
| Version | `0.6.0` (`expo.version`) |
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

Create the `app-store-production` GitHub Environment and restrict it to the `main`
branch. It has no required-reviewer gate: once a new `main` release reaches this
environment, the App Store upload runs automatically. Store the following values as
environment configuration (not in the repository):

- Variable: `APPLE_TEAM_ID` (`5H9F8F82WT`). `APP_STORE_PROFILE_NAME` is no
  longer required — the workflow reads the name out of the profile it installs,
  so rotating the profile is a one-secret operation. If the variable is still set
  and disagrees, the build warns and signs with the installed profile anyway.
- Secrets: `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_PRIVATE_KEY`,
  `APPLE_DISTRIBUTION_CERTIFICATE_BASE64`,
  `APPLE_DISTRIBUTION_CERTIFICATE_PASSWORD`, and
  `APP_STORE_PROVISIONING_PROFILE_BASE64`.

`ASC_PRIVATE_KEY` is the complete content of the downloaded App Store Connect
`.p8` file. The two `*_BASE64` secrets are base64-encoded copies of the signing
certificate `.p12` and the App Store provisioning profile respectively. Never
commit any of these files or their decoded values.

### Google Play automation

Create the `play-store-production` GitHub Environment and restrict it to the
`main` branch. It has no required-reviewer gate: once the release workflow reaches
this environment, the Play production upload runs automatically. Store the following
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

**The app reports anonymous usage counts.** They go to the publisher's own
OpenPanel instance at `panel.sanhouse.kr`, not to a third party, and there is no
account or profile to attach them to — the only identifier is the device-scoped
anonymous one the SDK keeps. Data Safety and App Privacy still have to say so:
declare app interactions / diagnostics, collected by the developer, used for
analytics, not linked to identity and not used for tracking. It is on by default
with a switch in Settings, so it is disclosed rather than consented to; if this
app ever needs GDPR consent for it, it belongs behind a consent flow of its own —
the ads no longer bring one, see below. What is sent is bounded by
`src/lib/analytics.ts` — a closed list of event names and property values that
can only be numbers, booleans or null, which is why no prompt, file name, path or
key can reach it.

**Both stores have to be told the app contains ads, separately from the privacy
answers.** Play has a "Contains ads" declaration on the app content page, which
also puts an "Ads" badge on the listing; the App Store asks the same question
when setting up the app's version information. This is not the privacy
questionnaire and answering that one does not answer this. A listing that does
not declare ads while the binary serves them is the mismatch enforcement looks
for, and on Play it is grounds for removal rather than a warning.

The app says so itself in Settings — "OpenScene is free. Ads pay for it" — which
is what makes the declaration and the product agree.

**The app shows ads, and that changes the privacy answers.** Ads are mediated by
Unity LevelPlay (formerly ironSource), with Unity Ads, AppLovin, Meta Audience
Network and Pangle bidding in through adapters. AdMob and the Google Mobile Ads
SDK are gone. All five of those SDKs are in the binary and all five report device
identifiers to their own network. Both stores ask about this directly and the
answers are no longer "none":

- **Data Safety / App Privacy** must declare device or other identifiers,
  collected by a third party, used for advertising. Declaring nothing here is
  the mismatch reviewers look for, and it is checked against the SDKs in the
  binary rather than against what the form says. The list of third parties is
  now five names rather than one, and Play's Data Safety form asks for them.
- **iOS** lists the SKAdNetwork identifiers Unity publishes for the mediated
  networks — seven of them, in `app.json`, reaching `Info.plist` at prebuild.
  Source and date are in `README-native.md`; do not hand-edit them.
- **App Tracking Transparency is not implemented**, deliberately. Without it the
  networks serve non-personalised ads, which needs no ATT prompt. Adding
  personalised ads means adding the prompt and the Info.plist string first.
- **Consent is no longer collected, because there is no longer a CMP.** Google's
  UMP came with the AdMob binding and left with it. What replaces it is the
  conservative default rather than a prompt: `ensureAdsReady` declares consent
  *not* given (`LevelPlay.setConsent(false)`) and sets CCPA's do-not-sell signal
  before initialising, so every network serves contextual inventory. It fails
  closed — if either signal cannot be applied, the SDK is never initialised and
  no ad is requested, rather than serving under the networks' own defaults. Personalised
  ads in the EU require a certified CMP first — that is a decision, not an
  omission.
- **App Transport Security carries an app-wide exception.**
  `NSAllowsArbitraryLoads` is set in `app.json`, which LevelPlay's integration
  guide requires: several mediated networks still serve creatives and make
  tracking calls over plain HTTP, and without it those requests fail silently as
  no-fill. Apple asks for this to be justified at review, and the justification
  is exactly that — third-party ad SDKs the app does not control the endpoints
  of. Nothing OpenScene itself talks to uses HTTP: the AI providers, the update
  feed and the analytics endpoint are all HTTPS, so the exception widens what the
  ad SDKs may do and nothing else. It is also why no narrower exception works —
  the hosts belong to five networks and change without notice.

  If review pushes back, the fallback is `NSAllowsArbitraryLoadsForMedia` plus
  per-network `NSExceptionDomains`, which each network publishes; expect it to go
  stale.

**Both placements have been seen to serve — through the Test Suite.** On an
Android emulator, with the Test Suite's Live/Test switch set to Test, the banner
unit renders a creative and the interstitial unit loads and plays one. The app
keys and all four unit ids match the dashboard.

What that does not prove is the app's own banner view. The Test Suite renders ads
with its own views; `AdBanner` mounts `LevelPlayBannerAdView`, which
`ironsource-mediation` registers as a legacy view manager while this app runs the
New Architecture. The failure mode is a banner that never appears rather than a
build error, so it still needs a look before a store build ships one — a release
that reaches users with a silently broken banner earns nothing and still declares
ad collection.

**Only four of the five networks are actually bidding.** The Test Suite lists
ironSource, Meta, Pangle and UnityAds against both ad units; **AppLovin is
absent** — the adapter is in the binary, but the network has no instance
configured for this app in the LevelPlay dashboard. Set it up there, or the store
build ships an SDK that is declared in the privacy answers and never asked to
bid.

**Two more to confirm on a real device.** Unity Ads did not initialise on the
emulator (`gateway_universal / PUBLIC_ERROR_CODE_INIT_UNKNOWN`) even though the
Test Suite lists it, and LevelPlay's ad-quality connector rejects every Pangle
SDK version the adapter can use — measurement rather than delivery. Neither
blocks the other networks; both belong on the list before reading revenue numbers
as real.

**There are two placements, and the interstitial is the one policy is strict
about.** Reviewed against the LevelPlay programme policies and each mediated
network's own; what the implementation does, and why:

| Policy | What the app does |
| --- | --- |
| No ad in front of a user-initiated action | The interstitial is presented after the export has produced a file and the result is on screen — never on the Export tap |
| No ad over loading content | Nothing is presented while the encoder runs |
| No ad on an unsuccessful action | A failed export shows nothing and releases the ad loaded for it |
| No impression the user cannot see | Refused unless `AppState` is `active`; an export can run for minutes and people put the phone down |
| Not repeatedly, in succession | One every five minutes at most |
| Initialised, with privacy signals set, before the request | `ensureAdsReady` gates the *request*, not the presentation |
| Nothing requested from a development build | Resolved in `src/lib/ads.ts`, not at the call site — LevelPlay has no test units, so development asks for nothing at all |
| No accidental clicks | The banner has its own block and a rule above it, clear of the tab bar's five 44pt targets, and is hidden while the keyboard is up |
| Publisher identifiable, policy reachable | Developer, site, contact, terms and privacy in Settings |

The LevelPlay app keys and the four ad unit ids live in `src/lib/ads.ts` and
nowhere else. Each one only ever serves the placement and the platform it was
made for — an interstitial id in a banner slot, or the reverse, is a policy
violation rather than a rendering bug, so a test asserts they stay distinct.

**Android export is implemented but unverified.** The Media3 Transformer path
is written, compiles, and installs; no export has been seen to produce a file.
Two attempts on an emulator ended with the emulator itself dying, which is a
resource problem rather than evidence either way — but it is not evidence that
it works.

Run one on a real device before submitting Android: import a clip, tap Export,
and confirm a playable file arrives in the photo library. If it does not, set
`isSupported` back to `false` in `VideoExportModule.kt` so the app says so
plainly rather than handing the user a path to nothing, and ship iOS first.

Overlapping video layers are composited now rather than refused: the plan says
which layer a segment belongs to and Android builds one Media3 sequence per
layer. That is the part with the least evidence behind it in this release — it
compiles and it is assembled the way `Composition` documents, and no device has
been seen to render two stacked clips. The preflight above is where that gets
answered: put one clip over another on a second track before deciding the feature
works.

**The published privacy policy has to say the app shows ads, before this
ships.** The app now states it in Settings — "OpenScene is free. Ads pay for it"
— and names Unity LevelPlay. The policy at `https://www.sloki9637.com/privacy`
says nothing about advertising, mediated networks, advertising identifiers, or
advertising as a purpose. An in-app disclosure the policy contradicts is worse
than neither: it is the app telling a reviewer where to look.

`store/privacy-policy-ads.md` holds the section to publish. Publishing it is not
a repository change and nothing here can check it, so it belongs on this list
rather than in a test.

**Age rating** — user-supplied prompts reach a generative model, so both stores
treat it as user-generated content. Expect questions about moderation; the
honest answer is that moderation is the provider's, since the app holds no
server of its own.
