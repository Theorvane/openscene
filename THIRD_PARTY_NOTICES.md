# Third-party notices and license inventory

This file records software deliberately used by this fork. It is an engineering inventory, not legal advice. Preserve the upstream `LICENSE` file and all required notices when redistributing the application.

## Application source

OpenScene is used as the application base under the MIT License.

- Project: https://github.com/Theorvane/openscene
- Copyright: 2026 Theorvane
- Pinned source: see `UPSTREAM_PINS.md`
- License text: `LICENSE`

No source from CutAgent, Weave, AutoVio, Velorn, Milimo Video, ComfyUI, Wan or LTX-Video has been copied into this repository during Phase 0.

## Direct JavaScript dependencies

The installed direct dependencies were inspected from their package manifests on 2026-09-02.

| Package group | Installed license |
|---|---|
| React, React DOM | MIT |
| Electron, electron-builder, electron-updater, electron-vite | MIT |
| Vite, Vitest and `@vitejs/plugin-react` | MIT |
| LangChain provider/core packages and LangGraph | MIT |
| `@theorvane/type-mcp` | MIT |
| Zod | MIT |
| TypeScript | Apache-2.0 |
| `@types/node`, `@types/react`, `@types/react-dom` | MIT |

Before a release, generate and review a complete transitive dependency report rather than relying only on this direct-dependency summary.

## System FFmpeg used for development

The current development machine uses `ffmpeg 9.0.1-full_build-www.gyan.dev` installed through winget package `Gyan.FFmpeg`.

Its configuration includes `--enable-gpl`, `--enable-version3`, `--enable-static`, `libx264`, `libx265` and `libass`. It is a system development dependency and is not copied into this repository. Bundling this build into an installer is not approved by this inventory.

For distribution, choose and document one of these paths:

1. require a user-provided FFmpeg installation;
2. ship a separately reviewed LGPL-compatible build with only the required codecs; or
3. accept the applicable GPL obligations for a bundled GPL build.

## Planned external services and model runtimes

| Component | Intended boundary | License action required before release |
|---|---|---|
| Gemini/Grok browser session | Connected service, per-operation approval | Review service terms and UI automation behavior; never redistribute session credentials |
| Gemini/xAI APIs | Connected service, per-operation approval | Record API terms, retention and pricing disclosure |
| ComfyUI | Separate worker process | Review GPL service/bundling boundary |
| Wan 2.2 and related weights | Worker model | Record code license, exact weight license and checksum separately |
| Whisper and model weights | Local ASR worker | Record source and model licenses/checksums separately |

## Dependency security snapshot

`npm ci` reported the following on 2026-09-02:

- root workspace: 7 advisories (1 moderate, 6 high);
- mobile workspace: 18 advisories (11 moderate, 7 high).

No automatic `npm audit fix` was run. Each advisory must be triaged on an issue-scoped branch because forced upgrades may change Electron, Expo or native SDK behavior.
