# AI Video Studio Phase 3A — Gemini Writer and storyboard

**Issue:** #8

**Branch:** `feat/8-gemini-writer`

**Status:** Implemented and verified

## Scope

- add idea-to-script, content-to-script, and screenplay-rewrite workflows;
- use Gemini 3.1 Pro Preview by default and Gemini 3.1 Flash-Lite as the
  lower-cost choice;
- require structured JSON output and validate it before any project mutation;
- materialize scripts, revision ancestry, characters, style bible, scenes, and
  detailed shots in the existing shared AI project domain;
- provide explicit preview, discard, and save steps on desktop and mobile;
- keep the desktop credential in the main process and the mobile credential in
  the device keystore;
- preserve unsaved desktop timeline state when an AI document is saved.

## Deferred

- Grok and browser-session Writer execution;
- live token/cost estimation;
- script import/export and collaborative editing;
- voice, subtitle, video, Start–End, reference, and motion-control execution.

## Verification gate

- request, prompt, schema, response, revision, ID, and project-graph tests;
- transport tests proving the API key is header-only and absent from desktop
  renderer/IPC contracts;
- desktop/mobile surface parity tests;
- root and mobile typechecks, production build, focused regressions, full-suite
  baseline comparison, and `git diff --check`;
- Electron development startup and an explicit note if interactive visual QA or
  a mobile development client is unavailable.

## Result

- Shared Writer workflow, Gemini transport, project-graph application, desktop
  IPC/UI, and mobile UI are implemented.
- Focused Writer/domain/surface regression suite: 30/30 tests passed.
- Root and mobile typechecks, production build, and `git diff --check` passed.
- Full suite: 1,130 passed and 40 failed. The 40 failures match the documented
  Windows/upstream baseline (filesystem `fsync` and symlink restrictions,
  FFmpeg/environment behavior, and CRLF-sensitive source/CI assertions); no
  Writer test failed.
- Electron development startup passed. Interactive visual QA was unavailable
  because no in-app Browser, Chrome session, or mobile development client was
  connected; startup evidence must not be described as visual verification.
- Follow-up Issue #10 strengthens the Gemini response schema with supported
  array/duration bounds and replaces the generic contract failure with a safe,
  field-level diagnostic after a real 480-second Flash-Lite test exposed the
  original message's lack of actionable detail.
