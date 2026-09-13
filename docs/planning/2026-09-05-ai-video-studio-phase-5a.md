# Phase 5A — Veo Start-End and visual continuity references

**Issue:** #320  
**Status:** Implemented; live paid-provider smoke test remains manual  
**Capability snapshot:** 2026-09-05

## Goal

Give every OpenScene entry point the same reviewable Veo 3.1 inputs before a paid generation request:

- text-only generation;
- one approved first frame;
- one approved first frame plus one approved last frame (Start-End);
- one to three approved character or product reference images.

## Completed

- Added a versioned shared input contract and rejected missing, mixed, excessive, or unsupported references before spend reservation.
- Updated the Gemini REST adapter to send `image.inlineData`, `lastFrame.inlineData`, and asset `referenceImages` without logging image bytes.
- Added desktop mode controls, image previews, explicit removal, duration gating, and exact-input retention for refined takes.
- Added equivalent mobile controls using the existing native image picker. Advanced reference modes are single-shot/manual; existing sequential last-frame continuity remains available for normal storyboard generation.
- Extended the MCP `createVideoJob` tool with first-frame, last-frame, and 1-3 asset-reference image job IDs while preserving the legacy first-frame alias.
- Added terminal lifecycle logs keyed by video job ID.

## Deliberate boundaries

- No provider call is made automatically while choosing or reviewing inputs.
- Start-End does not accept asset references in the same request.
- Arbitrary uploaded video prompting is not represented as image continuity. Veo extension requires an eligible Veo-generated video and remains deferred.
- Motion control and ComfyUI integration remain a later phase.

## Manual smoke test

1. Connect a Gemini API key and select `Veo 3.1 (Preview)`.
2. Choose **Start-End**, attach first and last frames, select 4/6/8 seconds, and generate only after reviewing both thumbnails.
3. Confirm the terminal reports `request.queued`, `process.started`, `provider.request.started`, then `request.completed` or a provider error for the same job ID.
4. Choose **References**, attach 1-3 images, confirm duration is fixed to 8 seconds, and generate.
5. Import a completed result and verify it appears on the project timeline.

Provider calls are paid and are therefore not part of automated tests.
