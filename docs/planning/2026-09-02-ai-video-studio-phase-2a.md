# AI Video Studio Phase 2A — media capability registry

**Issue:** #6

**Branch:** `feat/6-media-capability-registry`

**Status:** Implemented and verified

## Scope

- reuse the current provider adapters, job manager, spend gate, catalog, and storyboard planner;
- add a versioned model-level video capability registry;
- separate provider-declared capabilities from implemented request paths;
- centralize duration, aspect ratio, resolution, references, native audio, and adapter binding;
- validate before spending or network calls;
- derive desktop/mobile controls and planner lengths from the selected model;
- record current Veo and Grok operations without claiming deferred adapters work.

## Deferred to later Phase 2 issues

- xAI API execution and Grok browser automation;
- Veo Start-End/reference/extend execution;
- async cancellation/retry/download checksum improvements;
- live capability discovery and provider health checks;
- content Writer integration.

## Verification gate

- registry integrity and model/catalog parity tests;
- constraint and pre-network rejection tests;
- desktop/mobile/planner/job-manager source parity tests;
- existing adapter, storyboard, AI-domain, spend, and project-domain regressions;
- root typecheck/build, mobile typecheck, diff check, and full-suite baseline comparison.

## Result

- Added one versioned registry for model operations, exact duration/aspect/resolution constraints, reference counts, native audio, provider bindings, and source URLs.
- Kept provider-declared operations separate from request paths implemented by this build. Grok and advanced Veo operations are recorded but remain unavailable until their adapters carry every required input.
- Desktop, mobile, storyboard planning, MCP tools, and the job manager now derive model controls from the registry.
- Invalid combinations are rejected before spend reservation and before network access; valid requests are no longer silently rounded or coerced.
- Targeted regression suite: 101/101 tests passed. Root and mobile typechecks, production build, and `git diff --check` passed.
- Full suite: 1,118 passed and 40 failed. The 40 failures match the documented Windows/upstream baseline (filesystem `fsync`/symlink restrictions, FFmpeg/environment, and CRLF-sensitive source/CI assertions); no new Phase 2A test failed.
- Electron development startup passed. Automated visual interaction was not available because no Browser/Chrome session or mobile development client was connected; do not treat this run as visual QA.
