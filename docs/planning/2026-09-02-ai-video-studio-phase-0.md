# OpenScene AI Video Studio — Phase 0 bootstrap

**Status:** Baseline established; Issue #1 security boundary implemented; interactive account smoke test pending
**Date:** 2026-09-02
**Local branch:** `feat/1-browser-session-boundary`

## Decision

The first build is desktop-first and local-first. It keeps the OpenScene timeline and project store authoritative. Gemini and Grok are optional connected services, and every operation that sends text, an image, audio or video must disclose the provider and payload before it starts.

Authentication preference for this private local build:

1. an isolated browser session controlled by the user;
2. an official provider API key when available;
3. manual result import when a web workflow cannot be automated safely.

The application does not read cookies from an existing Chrome, Edge or Firefox profile. A user may log in inside an isolated profile or deliberately import a session for an allowlisted domain. CAPTCHA, login challenges, moderation and rate limits are not bypassed.

## Reuse finding

OpenScene already contains more of the requested product than the initial plan assumed:

- typed video, image and text-to-speech provider seams;
- an AI job manager and generation spend gates;
- a Narration workspace and narration-duration checks;
- OpenAI and ElevenLabs TTS adapters;
- Gemini 3.1 text/TTS model IDs in the generated catalog;
- local project assets, timeline editing and FFmpeg export;
- OS-encrypted credential stores;
- an approval-gated Edit Agent and TypeMCP tools.

Consequently:

- extend the existing `TextToSpeechProvider` seam for Gemini/xAI rather than creating a second Voice subsystem;
- add subtitle/ASR as a new shared contract because no complete caption/transcription pipeline exists;
- keep browser automation behind the same provider/job boundaries as API adapters;
- do not import an alternative editor codebase during the first implementation slice.

## Machine feasibility

| Check | Result | Consequence |
|---|---|---|
| Git | 2.53.0 | Supported |
| Node/npm | 24.14.1 / 11.11.0 | Root and mobile typechecks pass |
| FFmpeg | 9.0.1 Gyan full build | Media tests can run; development build is GPL-enabled and must not be bundled by default |
| GPU | GTX 1650, 4 GB | Wan 2.2 14B is not a local target; plan for a remote ComfyUI worker |
| GitHub CLI | 2.98.0, authenticated | Fork `3ongtam-coder/openscene` and Issue #1 created |

## Baseline verification

Commands executed from a clean upstream checkout:

| Command | Result |
|---|---|
| root `npm ci` | Pass; 489 packages installed; 7 advisories reported |
| root `npm run typecheck` | Pass |
| root `npm run build` | Pass |
| mobile `npm ci` | Pass; 515 packages installed; 18 advisories reported |
| mobile `npm run typecheck` | Pass |
| root `npm test` | Does not complete cleanly on this Windows baseline; failures summarized below |

Observed upstream Windows test blockers:

1. Asset/import tests fail with `EPERM: operation not permitted, fsync` when calling `FileHandle.sync()` on this filesystem.
2. Symlink security fixtures fail without Windows symlink privilege/developer mode.
3. `tests/clipSpeed.test.ts` derives `ffprobe` with `/ffmpeg$/`; on Windows the path ends in `ffmpeg.exe`, so the test invokes FFmpeg with FFprobe-only arguments and fails with `Unrecognized option 'select_streams'`.
4. Several source/CI assertion tests fail against the pinned upstream snapshot and need separate issue triage.
5. The latest aggregate run completed with 1,092 passing and 44 failing tests across 22 files. The remaining failures include the Windows filesystem/privilege issues above, FFmpeg not being visible on the inherited test-process PATH, and source/CI assertions already mismatched in the pinned upstream snapshot.

These are baseline findings, not changes introduced by this fork. Do not mix their fixes into the first Gemini/Grok authentication feature.

## Phase 0 exit status

- [x] Desktop-first/local-first product boundary selected.
- [x] OpenScene cloned and upstream commit pinned.
- [x] Root and mobile dependencies installed.
- [x] Root typecheck/build and mobile typecheck verified.
- [x] FFmpeg installed and its GPL-enabled configuration recorded.
- [x] GPU capacity measured; remote Wan/ComfyUI lane selected.
- [x] Initial direct-dependency/license inventory created.
- [x] Browser-session security design documented.
- [ ] Interactive Gemini login/session smoke test.
- [ ] Interactive Grok login/session smoke test.
- [x] Personal GitHub fork, issue and issue-scoped feature branch.

The remaining provider smoke tests require the user to complete login in the visible isolated windows. GitHub workflow is ready and the first feature is tracked by Issue #1.

## Recommended first feature issue

**Title:** Add isolated browser-session credential contract and status UI

Scope:

1. shared authentication mode and session-status types;
2. main-process encrypted session vault using Electron `safeStorage`;
3. preload bridge that exposes status and clear/re-auth actions but never cookie values;
4. desktop and mobile surfaces showing that browser session is desktop-only, with the mobile reason visible;
5. tests for domain allowlisting, redaction, expiry and deletion;
6. no Gemini/Grok DOM automation in this issue.

Implemented in `feat/1-browser-session-boundary`; targeted security/contract tests, root typecheck/build and mobile typecheck pass. The full upstream suite still has the Windows/baseline failures recorded above.

This contract-first slice follows `docs/hybrid-ai-editor-direction.md` and creates the safe boundary needed before provider-specific browser drivers.
