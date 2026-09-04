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

## Planned model and workflow pins

These integrations are not yet vendored or installed. Add an exact commit/tag, model-weight checksum and weight license before enabling one in a release.

| Project | Planned role | Current decision |
|---|---|---|
| ComfyUI | Remote/local workflow worker | Separate process/service; pin a stable release, not `master` |
| ComfyUI-WanVideoWrapper | Wan workflow nodes | Pin with every workflow bundle and run golden tests |
| Wan 2.2 | Motion control and character retarget | Remote GPU on the current machine; code and weights require separate license records |
| OpenAI Whisper | Local subtitle transcription | Add only with a reproducible runtime and model checksum |

## Update procedure

1. Fetch `upstream` without merging.
2. Review release notes, migrations and license changes.
3. Create an issue-scoped upgrade branch from `upstream/dev`.
4. Change one upstream layer per pull request.
5. Run root typecheck, root tests, root build and mobile typecheck.
6. Run media and workflow golden fixtures after those fixtures exist.
7. Update this file only after the upgrade is accepted.
