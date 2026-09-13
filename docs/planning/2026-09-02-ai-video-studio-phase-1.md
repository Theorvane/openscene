# AI Video Studio Phase 1 — versioned project domain

**Issue:** #4
**Branch:** `feat/4-ai-project-domain`
**Status:** Complete, awaiting review

## Scope

- upgrade the existing project snapshot from v3 to v4;
- add a shared, versioned AI planning/generation document;
- preserve the existing timeline v3 and atomic project writer;
- migrate project v1–v3 without losing asset or timeline data;
- expose one validated desktop save action;
- keep mobile persistence on the same shared contract.

## Deferred

- Grok session persistence smoke test is tracked separately by Issue #3;
- Writer UI and Gemini content prompts;
- generation providers and browser DOM drivers;
- storyboard and workflow views.

## Verification gate

- domain relation/limit tests;
- project codec migration tests;
- ProjectStore atomic persistence tests;
- IPC and desktop/mobile parity tests;
- root typecheck/build, mobile typecheck and diff check;
- full suite compared with the recorded Windows baseline.

## Verification result

- AI/domain/project/IPC/parity targeted suite: 54/54 passed during integration; final focused domain set: 30/30 feature tests passed.
- Root TypeScript and mobile TypeScript checks passed.
- Electron main, preload and renderer production build passed.
- `git diff --check` passed; only the repository's existing Git line-ending notices were reported.
- Full root suite: 1,108 passed, 40 failed. The failures remain in the recorded Windows/upstream baseline families (`fsync EPERM`, symlink permissions, FFmpeg/source/CI assertions); no new AI-domain test failed.
