# OpenScene Trust & Planning Design

**Issue:** #197
**Status:** Approved for implementation
**Date:** 2026-08-03

## Goal

Make OpenScene's public architecture and capability boundaries easy to understand, prevent valid requested video durations from being unnecessarily changed, and remove the known moderate MCP transitive dependency advisory.

## Scope

1. Add an architecture section to the root README, using a Mermaid diagram and concise ownership/boundary explanation.
2. Reconcile outdated planning and AI-direction documents with the capabilities that are actually implemented in the current product.
3. Replace the storyboard planner's greedy duration fill with an exact-first search over a bounded legal-duration set.
4. Upgrade `@theorvane/type-mcp` from `0.2.0` to `0.3.1`, bringing its MCP SDK dependency to a version that resolves the reported `@hono/node-server` advisory.

## Architecture documentation

The README diagram must show these real boundaries:

- **Renderer:** React UI, editor, generation studios, agent approval UI.
- **Preload:** narrow typed `window.videoTool` bridge; no raw IPC.
- **Electron main process:** local project/assets/chats, credential storage, provider calls, FFmpeg export, jobs, and TypeMCP tools.
- **Shared core:** portable timeline/composition/validation/planning/contracts consumed by desktop and mobile.
- **Local data:** project folders and Electron user data remain local.
- **Connected providers:** contacted only for an explicitly chosen/approved operation.

Program Monitor remains best-effort preview; local FFmpeg output remains authoritative.

## Documentation truth model

`README.md` is the public current-capability entry point. `docs/planning.md` and `docs/hybrid-ai-editor-direction.md` preserve historical decisions but must not contradict the current implementation. They will identify their historical/future content and link to README for current capability status.

## Storyboard planning contract

`planVideoStoryboard({ totalSeconds, providerId })` has a maximum of 24 shots and chooses only that provider's listed legal durations.

1. Normalize the request to the existing nearest positive integer policy and bounded maximum duration.
2. Search feasible duration combinations within the shot cap.
3. Prefer an exact total.
4. Among equally exact plans, prefer fewer shots; for ties, prefer longer earlier shots.
5. If no exact plan exists, choose the legal result with the smallest absolute distance from the requested duration. Tie-break toward fewer shots, then longer earlier shots.
6. Preserve sequential `startSeconds`, all legal-duration guarantees, continuity keys, and disclosed `roundedFrom` when the selected total differs from the requested total.

This makes a 10-second Google Gemini request use `[6, 4]` rather than the greedy `[8, 4]` (12 seconds), while an unrepresentable Sora 10-second request remains visibly rounded.

## Dependency security

The package-lock will be regenerated through npm after updating the direct TypeMCP dependency. The verification target is a clean `npm audit --omit=dev --audit-level=moderate` result, not a hand-edited lockfile.

## Non-goals

- New provider adapters or network calls.
- Automated timeline changes without approval.
- Cloud project storage, accounts, analytics, or UI redesign.
- Changes to persisted compatibility identifiers.

## Verification

- Focused planner and cost-gate tests show the new exact-first behavior.
- Full root tests, typecheck, build, and `git diff --check` pass.
- `mobile/` typecheck passes because the shared planning contract stays platform-neutral.
- Production dependency audit passes at the requested moderate threshold.
