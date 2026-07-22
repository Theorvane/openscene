# OpenVideo Agent Guide

## Architecture

OpenVideo is an Electron, React, TypeScript, and Vite desktop app. The app is split into three strict surfaces:

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
- OpenVideo stores recordings, projects, imported assets, voice profiles, TTS output, and exports locally under Electron `userData` unless an explicit local override exists.
- No cloud upload, analytics, account system, crash reporting, auto-update, or provider network calls are implemented.
- Future Gemini Veo, OpenAI Sora, and ElevenLabs support must remain behind provider seams until real adapters are added.

## Compatibility Identifiers

Do not rename these persisted or public identifiers while rebranding docs or UI:

- `window-loom-theme`
- `window-loom-editor-layout`
- `window-loom-editor-shortcuts`
- `application/x-window-loom-timeline`
- `VIDEO_TOOL_*`
- `window.videoTool`
- `local_qwen`

## Project Conventions

- Prefer typed shared contracts over ad hoc IPC payloads.
- Treat Program Monitor as best-effort preview. FFmpeg MP4 export is the supported final output for saved local timelines.
- Keep local Qwen TTS as a user-configured local wrapper. The app must not download models or promise model compatibility.
- Preserve consent boundaries for voice samples. Samples must be user-owned or authorized, stored locally, and deletable from the app store.
- When editing docs, use `OpenVideo` for the product name and keep compatibility identifiers exactly as written above.

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
