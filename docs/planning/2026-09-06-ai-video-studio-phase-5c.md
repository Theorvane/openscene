# AI Video Studio Phase 5C — ComfyUI Wan Motion Control

**Issue:** [#323](https://github.com/Theorvane/openscene/issues/323)  
**Branch:** `feat/323-comfyui-motion-control`

## Goal

Turn a reviewed character image and an imported driving video into a project-ready MP4 through a user-managed ComfyUI Wan Animate worker, without bundling a fragile model runtime or hiding missing nodes and VRAM limits.

## Delivered contract

- The shared capability registry exposes Wan 2.2 Animate as a motion-only, desktop-local model.
- **Move** transfers the driving performance to the reference character; **Mix** uses a separately configured character/background replacement workflow.
- OpenScene accepts ComfyUI API-format JSON only. It patches nodes by exact `_meta.title`, never by a workflow-specific numeric node id:
  - `OpenScene Character Image` — an `image` or `filename` input;
  - `OpenScene Driving Video` — a `video`, `file`, or `filename` input;
  - `OpenScene Prompt` — optional `text` or `prompt` input;
  - `OpenScene Output` — optional preferred MP4 output node.
- Before generation, health checks verify `/system_stats`, `/object_info`, configured workflow files, every required `class_type`, and an 8 GB total-VRAM safety floor. That floor prevents a known-impossible 4 GB run; it does not promise that 8 GB is enough for every workflow or resolution.
- The main process owns project-file access, uploads, queue polling, bounded download, partial-file cleanup and terminal progress logs. Paths, workflow JSON and bearer tokens never cross into the renderer or logs.
- A completed MP4 uses the existing reviewed **Import to project** path.

## Configuration

Copy `.env.example` settings into `.env`, use absolute workflow paths, restart OpenScene, choose **Wan 2.2 Animate 14B**, then press **Refresh worker**. A remote endpoint must use HTTPS. OpenScene neither installs custom nodes nor downloads model weights.

The current GTX 1650 4 GB development machine is not represented as capable of running Wan Animate 14B. Use a separately managed GPU worker with enough VRAM, or a remote HTTPS worker.

## Honest mobile boundary

The model remains visible but disabled on mobile. Motion Control requires desktop project-file access and a user-managed ComfyUI worker; mobile does not silently substitute a cloud model or upload the driving clip elsewhere.

## Verification gates

- API-workflow parsing, marker uniqueness and input patching tests.
- URL security and unconfigured-worker tests.
- Shared Motion Control request validation and model registry tests.
- Desktop/preload/mobile surface contract checks.
- Root typecheck, tests and production build; mobile typecheck.
- Before release: run both Move and Mix golden workflows on the pinned worker/node/model versions and record output hashes plus visual review.
