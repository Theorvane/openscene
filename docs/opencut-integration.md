# OpenCut editor integration

OpenScene tracks the MIT-licensed [Theorvane/OpenCut](https://github.com/Theorvane/OpenCut)
fork at `external/opencut` as a pinned Git submodule. Its upstream is
[OpenCut-app/OpenCut](https://github.com/OpenCut-app/OpenCut). Initialize after
cloning with `git submodule update --init external/opencut`.

The pinned commit is the reviewed merge of [OpenCut PR #3](https://github.com/Theorvane/OpenCut/pull/3)
on the independent `Theorvane/OpenCut` `main` branch. OpenScene does not track upstream changes automatically.

## Runtime boundary

OpenCut's web `/editor` route now supports a local Classic-inspired workflow.
OpenScene compiles three host-driven controls directly from that source:

- `EditorToolRail` — project, media, audio, and text tabs with keyboard access;
- `MediaLibrary` — search, sort, unused filter, grid/list view, import, drag, and placement controls;
- `EditPointNavigation` — previous/next timeline boundary buttons.

The OpenScene adapters in `src/renderer/src/editor/` supply project assets,
callbacks, labels, and drag payloads. Media filtering, usage counts, edit-point
calculation, timeline operations, and mobile parity remain in `src/shared/`.
The desktop still owns its project, monitor, FFmpeg export, and agent tools.
The OpenCut web route's browser-local timeline model is separate and is not
used to decide OpenScene editing outcomes.

The fork's web route can apply basic brightness, contrast, saturation, opacity,
and overlapping clip fades in its preview and local WebM recording. These
visual editing rules are limited to that standalone web editor. OpenScene
continues to use its own desktop FFmpeg pipeline, and mobile behavior stays on
its existing path; advancing the submodule adds no new cross-surface editing rule.

OpenCut UI source is bundled by Electron Vite, and `tsconfig.web.json` includes
only the imported component files. The submodule must be initialized before
`npm run typecheck`, `npm test`, or `npm run build`.

Keep local file paths and FFmpeg execution in Electron main. The renderer and
OpenCut components receive only typed data and callbacks. Update the fork in a
reviewed PR first, then update the submodule pointer in a separate OpenScene PR.
