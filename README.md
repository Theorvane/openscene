<p align="center">
  <img src="docs/assets/openscene-hero.png" alt="OpenScene: the wordmark beside a dark editor window showing a timeline and an agent chat that has trimmed a clip, added another, and is asking permission to export" width="100%" />
</p>

<h1 align="center">OpenScene</h1>

<p align="center">
  A local-first desktop video editor with an AI agent that can drive it — your media stays on your machine, and you choose which model providers, if any, it talks to.
</p>

<p align="center">
  <a href="#quick-start">Quick start</a> ·
  <a href="#the-workspace">The workspace</a> ·
  <a href="#the-edit-agent">Edit Agent</a> ·
  <a href="#on-a-phone">Mobile</a> ·
  <a href="#providers-and-models">Providers</a> ·
  <a href="#where-your-data-lives">Your data</a> ·
  <a href="CONTRIBUTING.md">Contributing</a>
</p>

<p align="center">
  <a href="LICENSE"><img alt="MIT License" src="https://img.shields.io/badge/license-MIT-7c3aed?style=flat-square" /></a>
  <a href="https://github.com/Theorvane/openscene/actions"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/Theorvane/openscene/ci.yml?branch=dev&style=flat-square&label=CI" /></a>
  <a href="https://github.com/Theorvane/openscene/issues"><img alt="Open issues" src="https://img.shields.io/github/issues/Theorvane/openscene?style=flat-square" /></a>
</p>

> [!IMPORTANT]
> **Early.** There are signed installers on the [releases page](https://github.com/Theorvane/openscene/releases) for macOS, Windows and Linux, and the app updates itself once installed. Running from source is still the fastest way to follow `dev`. The hero and screenshots below show the real interface.
>
> The desktop app was called **OpenVideo** through 0.2.0. Because the rename changes the application id, an existing OpenVideo install will not update itself to OpenScene — download 0.3.0 once and the old one can be removed.

## What is OpenScene?

OpenScene is an open-source video editor for your own machine — an Electron desktop app, and a React Native app that shares its editing core rather than approximating it. You open a folder as a project, put clips on a timeline, and export an MP4 with your local FFmpeg.

What makes it different is the **Edit Agent**: a chat panel that sits beside the timeline and can actually operate the editor — read the timeline, add and trim clips, generate voice or video, and start an export. It asks for approval before anything that changes your project.

Nothing is uploaded on its own. Model providers are opt-in, connected one at a time with your own API key or sign-in, and the app works with none of them connected.

## Architecture

```mermaid
flowchart LR
  Creator[Creator]

  subgraph Renderer["Renderer — React UI"]
    Editor["Timeline · Program Monitor"]
    Agent["Edit Agent · approval UI"]
    Studios["Voice · Image · Video studios"]
  end

  Bridge["Preload — typed window.videoTool bridge"]

  subgraph Main["Electron main process"]
    Policy["Validation · approval · provider policy"]
    Projects["Local projects · assets · chats"]
    Jobs["FFmpeg export · AI job manager"]
    Secrets["safeStorage · OAuth tokens"]
    Tools["TypeMCP tool surface"]
  end

  subgraph Shared["Shared editing core"]
    Timeline["Timeline rules · composition · validation"]
    Planning["Shot planning · cost estimation"]
    Contracts["IPC · provider contracts"]
  end

  Local[("User-controlled local files")]
  Providers["Connected providers\nonly after explicit approval"]

  Creator --> Renderer --> Bridge --> Main
  Renderer <--> Shared
  Main <--> Shared
  Main <--> Local
  Jobs --> Providers
  Tools --> Policy
```

The **renderer** collects intent and renders editor state; it never receives raw IPC, FFmpeg execution paths or arguments, or stored provider credentials and OAuth tokens. The **preload** layer exposes only the typed `window.videoTool` bridge. The **main process** owns local projects, secrets, job lifecycle, local FFmpeg execution, and the TypeMCP tool surface. Editing rules, composition, validation, and generation planning live in the portable **shared core**, which desktop and mobile use together.

Project folders, imports, generated results, chats, and exports remain local. A connected provider is contacted only for an operation you explicitly start: in a generation studio, that is the visible **Generate** action; for an agent-initiated mutation or job, the Edit Agent asks for approval before execution. The Program Monitor is a best-effort review surface; local FFmpeg MP4 export is the authoritative saved output.

## The workspace

Open a folder and you land in the workspace. One tab strip switches between editing and the two generation studios; the agent chat stays docked beside all three.

![The OpenScene editing workspace on a new project: media bin, program monitor, inspector, timeline tracks, and the Edit Agent chat panel docked on the right](docs/assets/screenshot-editor.png)

Projects and past conversations live on the start page. Picking a chat reopens its project and restores the transcript.

![The Projects page listing project folders beside Edit Agent chat history](docs/assets/screenshot-projects.png)

### Editing

- Import local media into a project folder and place it on video and audio tracks
- Trim, split, move, duplicate, and delete clips, with undo/redo
- Adjust opacity, scale, position, rotation, and volume, with keyframes, transitions, and per-track audio mix
- Review with a playhead and a best-effort Program Monitor
- Export H.264/AAC MP4 through your local FFmpeg
- Keyboard shortcuts throughout, remappable in Settings

### Voice generation

Write a script, pick a voice model, generate, and import the result straight into the project.

![The Voice Generation studio with a voice picker and a script composer](docs/assets/screenshot-voice.png)

### Video generation

Prompt with a style, aspect ratio, and duration — and optionally a reference image to seed image-to-video.

![The Video Generation studio with style, aspect ratio, duration, and reference image controls](docs/assets/screenshot-video.png)

### Image generation

Stills from a prompt, at the aspect ratio you need — and a seed for image-to-video on the engines that accept one.

![The Image Generation studio with model, aspect ratio, and prompt controls](docs/assets/screenshot-image.png)

## The Edit Agent

The chat panel is not a copilot that writes suggestions for you to apply. It calls the same operations the UI does, through a typed tool surface in the main process:

| The agent can | Tool |
| --- | --- |
| Read a project timeline and asset metadata | `getProjectTimeline` |
| Watch footage — sampled frames arrive as images it can actually see | `watchProjectVideo` |
| Place, trim, and restyle clips | `addClipToTimeline`, `trimTimelineClip`, `updateClipEffects` |
| Generate speech or video and follow the job | `createSpeechJob`, `createVideoJob`, `getJobStatus` |
| Import a finished generation into the project | `importGeneratedResult` |
| Start a local export | `exportProjectVideo` |

Anything that writes to your project or starts a job pauses for approval first. Read-only calls run immediately.

Conversations are kept per project as sessions: start a new one, switch back to an earlier one, or delete it. History is stored in a path-free `chats.json` inside the project folder.

## On a phone

`mobile/` is a React Native app that runs **the same editing rules as the desktop**. Every timeline
operation — placing, trimming, splitting, moving, what plays at a given moment, what an export
composites — is a pure function in `src/shared/`, imported by both. Neither reimplements a rule, which
is what stops a project behaving one way on a laptop and another on a phone.

Projects live inside the app rather than in a folder you file away, because a phone user has no
filesystem they think in. Export hands you the finished MP4 through the share sheet.

- A timeline with a preview, playback, pinch-to-zoom, draggable clips and trim handles, and a media bin
- Video, image and voice generation against the same provider catalog, with any OpenAI-compatible
  endpoint addable yourself
- A tool-calling assistant that shows every call for approval before it runs
- Spending permission asked **per kind** — allowing every image is a different decision from allowing
  every video, and they do not cost the same
- Multi-shot video that continues each shot from the last frame of the one before

Export renders natively with AVFoundation on iOS. **On Android it is not implemented yet and says
so** — editing, generation and frame extraction all work there; only the render does not.

```bash
cd mobile
npm install
npx expo run:ios     # or: npx expo run:android
```

## Providers and models

The provider and model registry is generated from a snapshot of the [models.dev](https://models.dev) catalog — roughly 150 providers and several thousand models — and is regenerated with `scripts/generateLlmCatalog.mjs`.

- **Local**: [Ollama](https://ollama.com) runs models on your machine with no key and no account.
- **Cloud chat**: connect a provider in *Settings → Providers* with an API key. Only connected providers' models appear in the pickers.
- **OpenAI**: two login methods on one provider — an API key, or a ChatGPT sign-in (PKCE OAuth) for the model set that backend serves. Tokens stay in main-process safe storage; the renderer only learns whether you are connected.
- **Generation**: 17 runnable video models across Google Veo, OpenAI Sora, Runway and Luma — Runway alone fronts Seedance, Veo 3.1, HappyHorse and Gemini Omni Flash on one key. Eight image models and seven voices. Providers without a real adapter stay listed but honestly unavailable rather than pretending to work, and every model says which it is.

A provider API key is entered in Settings and sent once through the typed bridge to Electron `safeStorage`; stored provider credentials are never returned to the renderer.

## Quick start

### Prerequisites

- Node.js 22+ and npm 10+
- FFmpeg, for MP4 export
- macOS: Screen Recording permission for the terminal running OpenScene, if you use window capture

### Install and run

```bash
git clone https://github.com/Theorvane/openscene.git
cd openscene
npm install
npm run dev
```

OpenScene uses **your** FFmpeg. Either make `ffmpeg` discoverable through an absolute directory on `PATH`, or point at it explicitly:

```bash
VIDEO_TOOL_FFMPEG_PATH=/absolute/path/to/ffmpeg npm run dev
```

Relative FFmpeg paths are rejected. Without a usable FFmpeg, OpenScene reports the problem instead of starting an export.

### Try the agent without any cloud account

```bash
ollama pull qwen2.5-coder
ollama serve
```

Then pick the local model in the chat panel's model picker. Note that watching footage needs a vision-capable model.

## Where your data lives

Projects are folders you choose. Assets, chat history, and generated results are written inside them; app-managed projects and recordings live under Electron user data.

```bash
VIDEO_TOOL_RECORDINGS_DIR=/absolute/path/to/recordings npm run dev
```

The renderer talks to the main process through a narrow typed `window.videoTool` bridge. Raw `ipcRenderer`, FFmpeg executable paths and arguments, stored credentials, and OAuth tokens stay outside it. Some safe display paths and an API key entered in Settings cross through explicit typed operations; a picked reference image, for example, crosses as bytes, never as a path.

- **No account, no telemetry.** No analytics, crash reporting, or usage tracking.
- **No background network calls.** The app talks to a provider only when you ask it to, using a provider you connected.
- **Capture is scoped.** Window capture grants access to the single source you select.
- **Removable.** Projects can be removed from the list — a folder you chose is only unregistered, never deleted recursively — and conversations can be deleted.

## Current boundaries

| Works today | Not yet |
| --- | --- |
| Selected-window capture to local WebM | Full-screen capture; mic or system-audio mix in the recorder |
| Local projects, media, timeline editing, undo/redo | A published mobile build — the app exists, the store listing does not |
| Local H.264/AAC MP4 export | Other export formats; frame-perfect multitrack mastering guarantees |
| Signed installers and auto-update on all three desktop platforms | Cloud sync, hosted rendering, accounts |
| Agent-driven editing, generation, and export | Unattended operation — changes ask for approval |
| Veo image-to-video via a reference image | Sora reference images (needs a multipart upload path this build does not send) |

Program Monitor is a best-effort review surface. FFmpeg export is the authoritative output.

## Verify from source

```bash
npm run typecheck
npm test
npm run build
```

`npm run build` compiles main, preload, and renderer into `out/`. It does not package an installer.

Some behavior can only be checked by hand: OS permissions, real provider calls, and final render quality.

## Contribute

1. Read [AGENTS.md](AGENTS.md) and search existing issues and pull requests.
2. Create or find a GitHub issue, update `dev`, and branch as `<type>/<issue-number>-<description>`.
3. Add or update tests for behavior changes.
4. Run the checks above and open a pull request against `dev`.

See [CONTRIBUTING.md](CONTRIBUTING.md), [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md), [SUPPORT.md](SUPPORT.md), and [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE)
