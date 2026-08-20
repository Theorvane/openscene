# OpenScene Agent Guide

## Architecture

OpenScene is an Electron, React, TypeScript, and Vite desktop app. The app is split into three strict surfaces:

- `src/main/`: Electron main process. Owns desktop capture selection, OS permissions, local file access, project storage, FFmpeg export jobs, local TTS jobs, app menu wiring, and shell open or reveal actions.
- `src/preload/`: typed bridge. Exposes the narrow `window.videoTool` API and never exposes raw `ipcRenderer`.
- `src/renderer/`: React UI. Owns capture controls, project timeline editing, Program Monitor preview, narration UI, and editor state.
- `src/shared/`: IPC names, validators, timeline models, export types, and provider seam types shared across main, preload, renderer, and tests.

## Commands

```bash
npm install
npm run dev
npm run typecheck
npm test
npm run build
```

`npm run build` runs typecheck first, then builds Electron main, preload, and renderer output into `out/`. It does not package an installer.

## Code And Tests

- Tests live in `tests/**/*.test.ts` and run in Node through Vitest.
- Main process tests usually cover stores, validators, job logic, FFmpeg argument boundaries, and IPC services without launching Electron.
- Renderer behavior lives under `src/renderer/src/`, with timeline editor logic split across hooks, model helpers, and components.
- Shared timeline logic and validators should stay in `src/shared/` when both renderer and main process need the contract.

## Local-First And Security Constraints

- Keep `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, `webSecurity: true`, and blocked window navigation.
- File paths, FFmpeg executable paths, FFmpeg argv, voice sample paths, and generated output paths stay in the main process. The renderer gets typed job status and open or reveal actions.
- OpenScene stores recordings, projects, imported assets, voice profiles, TTS output, and exports locally under Electron `userData` unless an explicit local override exists.
- No cloud upload, analytics, account system, crash reporting, or auto-update is
  implemented on the desktop. `mobile/` has three deliberate exceptions, none of
  which exists on the desktop: it calls providers directly — generation runs
  against the user's own accounts, per operation and behind the spend prompt — it
  carries the Google Mobile Ads SDK for a banner and an interstitial, which
  reports device identifiers to Google, and it reports anonymous usage counts to
  the publisher's own OpenPanel instance.
- Each is an exception to that line rather than a widening of it. Usage reporting
  in particular is bounded by `mobile/src/lib/analytics.ts`: a closed list of
  event names, property values restricted to numbers, booleans and null, and no
  profile ever identified. A prompt, a file name, a path or a key is not a thing
  that list can express. Adding an event means adding it there and deciding
  whether it belongs, and the switch is in Settings, on by default and stated in
  the app rather than only in a policy.
- Future hybrid AI support must follow [`docs/hybrid-ai-editor-direction.md`](docs/hybrid-ai-editor-direction.md): local models are user-configured, connected services are selected and authorized per operation, and provider adapters remain behind typed seams until a separately reviewed implementation adds them.

## Compatibility Identifiers

Do not rename these persisted or public identifiers while rebranding docs or UI:

- `window-loom-theme`
- `window-loom-editor-layout`
- `window-loom-editor-shortcuts`
- `application/x-window-loom-timeline`
- `VIDEO_TOOL_*`
- `window.videoTool`
- `local_qwen`

Left behind by the OpenVideo → OpenScene rename, for the same reason the
`window-loom-*` names above survived the one before it — renaming a key does not
migrate what is stored under it, it orphans it:

- `openvideo-*` renderer storage keys (theme-adjacent preferences, model
  selection, workspace tab, reasoning effort, agent chat layout)
- `openvideo.` — the mobile keystore prefix. Renaming this loses every API key
  the user has stored.
- `openvideo-mcp-server` — the MCP server name, which clients match on
- `tech.theorvane.openvideo` — the Electron appId. It identifies an installed
  application: changing it orphans every existing install and silently breaks
  auto-update for anyone already on an earlier version.
- `executableName: openvideo` and the `openvideo-${version}` artifact names
- `OpenVideoMcpServer` / `getOpenVideoMcpDefinition` — source identifiers

## Project Conventions

- Prefer typed shared contracts over ad hoc IPC payloads.
- Treat Program Monitor as best-effort preview. FFmpeg MP4 export is the supported final output for saved local timelines.
- Keep local Qwen TTS as a user-configured local wrapper. The app must not download models or promise model compatibility.
- Preserve consent boundaries for voice samples. Samples must be user-owned or authorized, stored locally, and deletable from the app store.
- When editing docs, use `OpenScene` for the product name and keep compatibility identifiers exactly as written above.

## Two Surfaces, One Core

The desktop app and `mobile/` are two front ends over the same editing rules.
A feature is not finished on one of them.

- **Put the rule in `src/shared/` first.** Anything that decides an outcome —
  what a trim does, what plays at a moment, what an export composites, what a
  model costs — is a pure function there, imported by both. Neither surface
  reimplements a rule. A project that behaves one way on a laptop and another on
  a phone is the failure this exists to prevent, and it is discovered by users,
  not by tests.
- **Ship the mobile screen in the same pull request.** Not a follow-up issue:
  a feature that lands on the desktop alone leaves the shared core with a caller
  on one side only, and the second caller is what proves the seam was drawn in
  the right place. It has found real mistakes — `NodeJS.Platform` in shared code,
  and image adapters returning a Node `Buffer` — each caught by the mobile
  typecheck and by nothing else.
- **Say so when a surface genuinely cannot have it.** Some things are honestly
  platform-bound: window capture has no phone equivalent, and Android export is
  not written yet. Those stay visible and disabled with the reason, in the UI and
  in the pull request. Silence reads as an oversight; a stated limit reads as a
  decision.
- **Verify on both.** `npm run typecheck && npm test && npm run build` at the
  root, `npm run typecheck` in `mobile/`, and the screen exercised on a
  development client. The mobile typecheck is not optional — it is the only
  check that compiles the shared core against a non-Node environment.
- **Do not reach for a native module to avoid sharing.** Native code is for what
  only the platform can do — AVFoundation and Media3 for rendering, the keystore
  for secrets. It is not a place to put a rule that both surfaces need.

## Agent Skills & TypeMCP Integration

- **Agent Skills Location**: `.agents/skills/api-to-typemcp/SKILL.md` (Integrates `api-to-typemcp` skill for converting OpenAPI/Swagger specifications or API docs into TypeMCP MCP projects).
- **TypeMCP Server & Tools**: OpenScene internal process capabilities (AI video generation, TTS speech synthesis, job status tracking) are declared as standard TypeMCP tools (`@theorvane/type-mcp`) in `src/main/openVideoMcpServer.ts` and exposed over IPC (`window.videoTool.mcpGetTools` / `mcpExecuteTool`).

## Required Issue, Branch, And PR Workflow

Every change after the initial repository bootstrap follows this sequence. Never commit directly to protected `dev` or `main`.

1. Inspect open GitHub Issues and pull requests, then create or update one focused GitHub Issue before branching.
2. Put the issue number in the branch name: `<type>/<issue-number>-<short-description>`, such as `feat/12-tool-compiler` or `chore/1-strict-workspace-baseline`.
3. Branch from the current `origin/dev` unless a documented stacked pull request requires another base.
4. Implement one coherent issue only. Use conventional commits in the format `type(scope): subject`.
5. Push the branch and open a pull request against `dev` with `Closes #<issue-number>` in the body.
6. Run and report fresh verification evidence. Obtain specification and code-quality review before merging.
7. Squash merge only after CI and review pass. Verify the issue closes and `dev` contains the merged commit.
8. Promote vetted `dev` to release-only `main` through a separate reviewed release pull request. Verify `main` contains the release commit before publication.
9. Store listings are filled in from `store/`, not written into the consoles from memory. One file per store per language — `store/app-store/whats-new.<locale>.txt`, `store/google-play/release-notes.<locale>.txt` — and both stores carry the same set of languages. The App Store text may not name another platform — App Review refuses it under Guideline 2.3.10, and `tests/storeReleaseNotes.test.ts` refuses it first.
10. The version in `package.json` is the release decision. Bump it on `dev` before promoting: the push to `main` tags `v<version>`, creates a `release/v<version>` branch, packages macOS, Windows, and Linux on their own runners, and publishes the release with every artifact attached. Promoting without a bump republishes nothing, by design.
