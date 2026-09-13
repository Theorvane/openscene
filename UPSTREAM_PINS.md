# Upstream pins

This fork follows upstream projects deliberately. Updates are reviewed and tested; they are not pulled automatically into a working branch.

## Application base

| Project | Upstream | Branch | Pinned commit | Commit date | License | Purpose |
|---|---|---|---|---|---|---|
| OpenScene | https://github.com/Theorvane/openscene | `dev` | `86e4be3ae2eeed51ba48abaa9df2a8bce46b6715` | 2026-08-29 | MIT | Desktop editor, shared timeline, provider seams, job management and local export |

The local clone keeps OpenScene as `upstream`; the writable `origin` is the personal fork at `https://github.com/3ongtam-coder/openscene.git`.

## Runtime baseline

| Component | Baseline | Status |
|---|---|---|
| Windows | Current development machine | Active |
| Node.js | `v24.14.1` | Root and mobile typechecks pass |
| npm | `11.11.0` | Root and mobile dependencies installed with `npm ci` |
| FFmpeg/FFprobe | `9.0.1-full_build-www.gyan.dev` | Installed system-wide with winget; GPL/version 3 enabled; do not bundle into a closed distribution without a separate license decision |
| GPU | NVIDIA GeForce GTX 1650, 4 GB VRAM, compute capability 7.5 | Insufficient for the planned Wan 2.2 14B local workflow; use a remote worker or cloud lane |

## Model and workflow pins

OpenScene now contains a generic ComfyUI API-workflow adapter, but does not vendor or install the worker, nodes, workflows, or weights. Add an exact commit/tag, model-weight checksum and weight license to a deployment record before enabling a workflow in a release.

| Project | Planned role | Current decision |
|---|---|---|
| ComfyUI | Remote/local workflow worker | API adapter implemented; deployment remains a separate process/service and must pin a stable release, not `master` |
| ComfyUI-WanVideoWrapper | Wan workflow nodes | Supported through user-supplied API workflow; pin with every workflow bundle and run golden tests |
| Wan 2.2 | Motion control and character retarget | Move/Mix seam implemented; use a remote GPU on the current machine, and record code/weight licenses separately |
| whisper.cpp | Local subtitle transcription | Managed Windows x64 release `b4938` / version `1.9.3` (MIT), release archive SHA-256 `c2a4b60edb11f7e11a9191ffb50929535527d4d91c9903dbe3e554583bbbc63d`; the adapter still follows reviewed commit `52a939a2a762224e255d366c1182b2af4dd1a032` |
| ggml-small.bin | Multilingual local subtitle model | `ggerganov/whisper.cpp` commit `5359861c739e955e79d9a303bcbc70fb988958b1` (MIT metadata), SHA-256 `1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b`; installed only under ignored `.local-runtimes/` |
| VieNeu-TTS v3 Turbo | Local Vietnamese narration | Separate checkout `pnnbao97/VieNeu-TTS` commit `6c12b81a369ac61ef906f1c936b5c983f2603660` (Apache-2.0 code); OpenScene synchronizes its `.venv` and launches its loopback demo, while model/voice terms remain non-commercial and separately governed |

## Update procedure

1. Fetch `upstream` without merging.
2. Review release notes, migrations and license changes.
3. Create an issue-scoped upgrade branch from `upstream/dev`.
4. Change one upstream layer per pull request.
5. Run root typecheck, root tests, root build and mobile typecheck.
6. Run media and workflow golden fixtures after those fixtures exist.
7. Update this file only after the upgrade is accepted.
