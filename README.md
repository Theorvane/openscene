# OpenVideo

OpenVideo is an Electron, TypeScript, React, and Vite MVP for recording one selected desktop window to a local WebM file and arranging local media in a project timeline. It follows the product contract in `docs/planning.md`: selected-window capture, local project and asset storage, timeline editing, and future Gemini Veo, OpenAI Sora, and ElevenLabs support left as provider seams.

## What Works Now

- Lists capturable desktop windows through Electron `desktopCapturer` in the main process.
- Treats source lists as generations, so a refresh invalidates old selections.
- Uses a secure main, preload, and renderer split with `contextIsolation: true`, `nodeIntegration: false`, and `sandbox: true`.
- Exposes only a narrow typed `window.videoTool` API from preload. Raw `ipcRenderer` is not exposed.
- Lets the renderer request `getDisplayMedia`, while the main process grants only the currently selected source through `setDisplayMediaRequestHandler`.
- Streams `MediaRecorder` chunks to the main process every second and writes them incrementally to disk.
- Saves WebM files under Electron user data in `recordings/`.
- Shows source selection, preview, record, pause, resume, stop, elapsed time, state, result metadata, open, and reveal actions.
- Creates local projects with imported local assets.
- Stores project data locally, including assets, tracks, clips, and timeline metadata.
- Supports timeline tracks and clips for local editing.
- Supports clip trim, split, and delete actions in the timeline.
- Stores clip opacity, scale, position, rotation, volume, keyframes, transitions, and audio track mix settings locally.
- Shows playhead movement and a local preview surface for timeline review, including best-effort keyframe, transition, and audio mix evaluation.
- Exports saved local project timelines to MP4 with H.264 video and AAC audio through a local FFmpeg runtime.
- Stores local voice reference samples only after explicit consent and supports deleting saved local voice profiles.
- Can start local `local_qwen` TTS jobs when a local wrapper is configured through `VIDEO_TOOL_TTS_CONFIG_PATH`.

## Prerequisites

- Node.js 22 or newer.
- npm 10 or newer.
- macOS Screen Recording permission for the terminal or packaged app that launches Electron.
- FFmpeg for MP4 export. Set `VIDEO_TOOL_FFMPEG_PATH` to an absolute executable path, or make `ffmpeg` discoverable from an absolute directory on `PATH`.

## Install

```bash
npm install
```

## Development

```bash
npm run dev
```

On the first capture attempt, macOS may block the preview until permission is granted.

## macOS Screen Recording Permission

1. Open System Settings.
2. Go to Privacy & Security.
3. Open Screen & System Audio Recording.
4. Enable the terminal app you use for `npm run dev`, or enable the packaged OpenVideo app.
5. Quit and relaunch the terminal or app after changing permission.
6. Press Refresh in OpenVideo and select the target window again.

Automated tests cannot grant this permission, so real capture must be manually verified on macOS.

## Verify

```bash
npm run typecheck
npm test
npm run build
```

## Build Output

```bash
npm run build
```

The command compiles the Electron main process, preload, and React renderer into `out/`. It does not package an installer or auto-updater.

## Recording Storage

By default, recordings are written to:

```text
<Electron userData>/recordings
```

For development, you can override this with:

```bash
VIDEO_TOOL_RECORDINGS_DIR=/absolute/path/to/recordings npm run dev
```

## Local Project And Timeline Storage

Timeline editing is local-only in this MVP. Projects keep imported assets, tracks, clips, trim ranges, split results, deletes, clip effects, keyframes, transitions, audio track mix settings, playhead position, and preview state in the local app storage path. Clip effects cover opacity, scale, position, rotation, and volume. They persist through timeline undo and redo, save, and reopen. The app does not upload projects or assets to a cloud service.

Implemented local editing covers project creation, asset import, track and clip arrangement, trim, split, delete, clip effects, keyframes, transitions, audio track mix settings, playhead movement, and the single active Program Monitor preview. Program Monitor is a best-effort renderer evaluation surface for review. The FFmpeg export path is the authoritative local output for supported saved timeline state.

## Local MP4 Export

OpenVideo can export the currently saved local project timeline to an app-owned MP4 result. Export uses a local FFmpeg executable only and renders H.264 video with AAC audio in an MP4 container. The renderer starts, polls, cancels, opens, and reveals exports through typed `window.videoTool` job actions. It does not receive output paths, FFmpeg executable paths, or FFmpeg argv.

FFmpeg discovery is explicit and local. Set `VIDEO_TOOL_FFMPEG_PATH=/absolute/path/to/ffmpeg` to pin an executable, or ensure `ffmpeg` is available from an absolute directory listed in `PATH`. Relative configured paths are rejected. If FFmpeg is unavailable, export controls report the local runtime problem and do not start a job.

Export boundaries are intentionally narrow. MP4 H.264/AAC is the only implemented final export format, exports run locally, partial outputs are discarded on failure or cancel, and no cloud render or export path exists.

## Local Qwen Voice Profiles And TTS Setup

Local voice profiles and Qwen TTS are current local audio asset extensions. Selected-window capture, WebM recording, and local project timeline editing remain the core MVP scope. TTS does not replace recording. It uses a user-approved local voice sample to create a separate audio asset.

See [`docs/local-qwen-voice-profiles.md`](docs/local-qwen-voice-profiles.md) for setup details. See [`docs/local-qwen-tts-config.example.json`](docs/local-qwen-tts-config.example.json) for a safe placeholder config example.

Core settings and boundaries:

- `VIDEO_TOOL_TTS_CONFIG_PATH` is the absolute path to the local TTS JSON config file.
- OpenVideo does not download Qwen models or runtimes.
- A local wrapper targeting `Qwen/Qwen3-TTS-12Hz-1.7B-Base` must be prepared by the user first.
- `executablePath`, `modelPath`, `workingDirectory`, and `VIDEO_TOOL_TTS_CONFIG_PATH` values must be absolute paths.
- `argsTemplate` must include `{modelPath}`, `{voiceSamplePath}`, `{textPath}`, and `{outputPath}` tokens. It may also include `{language}`.
- Reference voice samples must be clear samples, usually 10 to 30 seconds, from the user or from someone who gave permission.
- Deleting a saved voice profile removes that profile directory and sample metadata from local app storage. Pending samples can be discarded.
- GPU VRAM, memory, and latency requirements depend on the wrapper and model runtime. Treat a local ML environment capable of running a 1.7B-class model as a manual prerequisite.

Reference boundaries are also explicit. Voicebox is a reference for the local profile workflow. OpenCut is inspiration for local-first asset and timeline UX only. This rewrite does not use OpenCut code or dependencies, and this repository does not claim to copy code from either project.

## Compatibility Identifiers

Some persisted or public names still contain legacy naming and must remain unchanged for compatibility:

- `window-loom-theme`
- `window-loom-editor-layout`
- `window-loom-editor-shortcuts`
- `application/x-window-loom-timeline`
- `VIDEO_TOOL_*`
- `window.videoTool`
- `local_qwen`

## Current Limitations

- Window capture only. Full-screen capture is intentionally out of scope.
- No microphone or system-audio capture is mixed into the selected-window recorder. Microphone access is used only in the explicit local voice-profile sample workflow.
- No cloud upload, analytics, account system, auto-update, or crash reporting.
- If the selected window closes, the renderer stops safely when the stream ends or when the main-process availability check reports it missing.
- Recording output is WebM. Final timeline export output is MP4 H.264/AAC only.
- Program Monitor preview is best-effort and not a frame-perfect final render. FFmpeg MP4 export is implemented for supported saved local timelines, but true multitrack or frame-perfect mastering guarantees are not claimed.
- No Gemini Veo, OpenAI Sora, ElevenLabs, or other AI video provider integration exists yet.
- Local TTS depends on a user-provided wrapper and local model files. Model compatibility is not promised by the app.

## Manual QA Checklist

Use this checklist before claiming the MVP works end to end:

1. Launch the app with `npm run dev` on macOS with Screen Recording permission available.
2. Refresh sources, select one desktop window, confirm the preview shows only that window, then record, pause, resume, and stop.
3. Confirm the WebM result is saved locally, opens from the app, and can be revealed in the file system.
4. Create a local project, import at least one recorded or local media asset, and confirm it appears in the asset list.
5. Add imported assets to timeline tracks as clips.
6. Move the playhead and confirm the preview follows the current timeline position.
7. Trim a clip, split it, delete one resulting segment, change opacity, scale, position, rotation, and volume, and confirm the timeline state stays local through undo and redo, saving, and reopening the project.
8. Confirm keyframes, transitions, and audio mix settings are visible in Program Monitor as best-effort preview evaluation, then save the timeline.
9. With FFmpeg configured through `VIDEO_TOOL_FFMPEG_PATH` or an absolute `PATH` entry, start MP4 export, watch queued or running progress, cancel one job, then complete a second job and verify Open and Reveal work without showing local paths in the renderer.
10. Confirm there is no cloud upload, AI video generation, multiple export formats, or frame-perfect or multitrack mastering guarantee presented as implemented.

## Contributing and Community

OpenVideo welcomes focused, local-first contributions. Read [CONTRIBUTING.md](CONTRIBUTING.md) for the issue-to-branch-to-`dev` pull-request workflow, [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) for participation standards, [SUPPORT.md](SUPPORT.md) for help, and [SECURITY.md](SECURITY.md) before discussing a potential vulnerability. This project is available under the [MIT License](LICENSE).

## Future Provider Seams

`src/shared/providerSeams.ts` defines interfaces only:

- `VideoGenerationProvider` for future Gemini Veo and OpenAI Sora adapters.
- `TextToSpeechProvider` for future ElevenLabs adapters and the current local `local_qwen` seam.

No external AI SDKs are installed and no provider network calls are made by this app.
