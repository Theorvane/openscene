# The advertising section the published privacy policy is missing

The mobile app says, in Settings, that ads are what pay for it, and names Unity
LevelPlay. The policy at `https://www.sloki9637.com/privacy` says nothing about
advertising at all — no mediated networks, no advertising identifiers, no
advertising as a purpose.

That gap is not a documentation nicety. Both stores check the privacy answers
against the SDKs in the binary, and an app that discloses ads to its users while
its policy does not is the app pointing a reviewer at the discrepancy itself.

Publishing this is a change to a website rather than to this repository, so
nothing here can test it. `RELEASING.md` lists it as a step that blocks a
release.

Below is the section to publish, in both languages, written to match what the app
actually does — `src/lib/adsModule.ts` for the posture, `plugins/withLevelPlayMediation.js`
for the list of networks. If either changes, this changes with it.

---

## English

### Advertising

The OpenScene mobile app is free and is funded by advertising. The desktop app
shows no ads.

Ads are mediated by **Unity LevelPlay** (formerly ironSource). Depending on the
ad shown, one of the following networks may serve and measure it: Unity Ads,
AppLovin, Meta Audience Network, or Pangle. Each of these is an independent
controller of the data it collects, under its own privacy policy.

**What they receive.** Advertising and device identifiers (the Google
Advertising ID on Android, the Identifier for Vendors on iOS), coarse device and
network information such as device model, operating system version, language and
country, and the fact that an ad was requested, shown, or clicked in this app.

**What they do not receive.** Your projects, your media, your prompts, your file
names, and the API keys you connect. None of these leave your device except to
the AI provider you choose, which is described elsewhere in this policy.

**Personalisation.** The app requests non-personalised advertising: before the
advertising SDK is initialised it declares that consent for personalised
advertising has *not* been given and sets the "do not sell or share my personal
information" signal. App Tracking Transparency is not implemented on iOS, and the
app does not track you across other companies' apps and websites.

**Your choices.** Both platforms let you limit ad tracking or reset your
advertising identifier in the operating system's settings: on iOS under Settings
› Privacy & Security › Tracking and Apple Advertising, and on Android under
Settings › Privacy › Ads.

Unity LevelPlay's privacy policy: https://unity.com/legal/game-player-and-app-user-privacy-policy

---

## 한국어

### 광고

OpenScene 모바일 앱은 무료이며 광고로 운영됩니다. 데스크톱 앱에는 광고가 없습니다.

광고는 **Unity LevelPlay**(구 ironSource)가 중개합니다. 노출되는 광고에 따라 Unity
Ads, AppLovin, Meta Audience Network, Pangle 중 한 곳이 광고를 제공하고 성과를
측정할 수 있습니다. 각 사업자는 자사 개인정보처리방침에 따라 수집한 정보를 독립적으로
처리합니다.

**전달되는 정보** — 광고·기기 식별자(Android의 광고 ID, iOS의 IDFV), 기기 모델·운영체제
버전·언어·국가 등 개략적인 기기 및 네트워크 정보, 그리고 이 앱에서 광고가 요청·노출·
클릭되었다는 사실.

**전달되지 않는 정보** — 프로젝트, 미디어 파일, 입력한 프롬프트, 파일 이름, 연결한 API
키. 이들은 사용자가 선택한 AI 제공자에게 전송되는 경우를 제외하고 기기를 떠나지 않으며,
그 부분은 본 방침의 다른 항목에서 설명합니다.

**맞춤 광고** — 이 앱은 맞춤형이 아닌 광고를 요청합니다. 광고 SDK를 초기화하기 전에
맞춤 광고에 대한 동의가 **없음**을 선언하고, "개인정보 판매·공유 거부" 신호를 설정합니다.
iOS의 앱 추적 투명성(ATT)은 구현하지 않았으며, 다른 회사의 앱이나 웹사이트에서 사용자를
추적하지 않습니다.

**선택권** — 두 플랫폼 모두 운영체제 설정에서 광고 추적을 제한하거나 광고 식별자를
재설정할 수 있습니다. iOS는 설정 › 개인정보 보호 및 보안 › 추적 및 Apple 광고,
Android는 설정 › 개인정보 보호 › 광고입니다.

Unity LevelPlay 개인정보처리방침: https://unity.com/legal/game-player-and-app-user-privacy-policy
