# OpenScene Product Plan — Historical MVP Baseline

> **Current capability source:** [the root README](../README.md) is the current product and release boundary. This document records the 2026-07-20 MVP baseline and its original implementation plan; its former “future” provider and voice statements are not a claim about the current `dev` branch.

Status: Historical planning baseline
Created: 2026-07-20
Audience: product decision-makers, implementers, and security reviewers

## 1. Product Goal

OpenScene is an Electron video production app for selecting one desktop window, recording only that window, and editing the result with imported local assets in a local project timeline. The implementation started with capture and recording. It now includes local projects, assets, tracks, clips, and timeline editing.

The user should be able to create work demos, lessons, product walkthroughs, and short presentation videos without setting up a full broadcast tool. The app should reduce accidental privacy exposure by recording a selected window instead of the entire screen.

The longer-term direction is still a hybrid AI editor: local recording and editing remain primary while optional connected services support the currently shipped generation workflows and future assisted-editing workflows. The historical direction, data boundary, consent requirements, shared job architecture, and remaining future constraints are in [`hybrid-ai-editor-direction.md`](hybrid-ai-editor-direction.md). For what is released on the current branch, including provider-specific availability, use [the root README](../README.md).

## 2. Core Users

| User | Main Goal | Success Criteria |
|------|-----------|------------------|
| Product demo creator | Record one app window for a demo video. | Only the target window is recorded and the result can be opened immediately. |
| Instructor | Record an editor, browser, or document window. | Longer recordings keep stable capture and timing. |
| Marketer | Create feature introduction videos quickly. | Recording output can later feed AI video or speech synthesis workflows. |
| Developer | Capture reproducible app behavior as video. | Sensitive unrelated windows are not recorded. |

## 3. MVP Scope

The MVP focuses on choosing one desktop window, recording it, saving the result locally, and using the result or imported local media in a project timeline. Selected-window recording is first because it lowers privacy risk and makes the output easier to control.

The current implementation keeps capture scope stable and adds local timeline editing plus local MP4 export for saved timelines. Users can create a local project, import recorded or local media into the asset list, arrange assets as tracks and clips, trim, split, delete, move the playhead, and preview the timeline. Clip opacity, scale, position, rotation, volume, keyframes, transitions, and audio track mix settings are saved as local timeline state and take part in undo, redo, save, and reopen flows. Program Monitor is a best-effort preview. FFmpeg MP4 export is the supported final local output for saved timelines.

Local voice profile storage and local Qwen TTS jobs are separate local audio asset extensions. They are not cloud provider integrations, multiple export formats, frame-perfect mastering, final multitrack rendering, or a guarantee of model compatibility.

### 3.1 Included

1. Show available desktop windows.
2. Let the user select one window.
3. Preview only the selected window.
4. Support record, pause, resume, and stop.
5. Save recording output to a local file.
6. Show save location, file name, duration, and file size.
7. Show current recording state and elapsed time while recording.
8. Stop safely if the selected window closes or becomes unavailable, then explain why.
9. Create and save local projects.
10. Manage imported local media and recording results as project assets.
11. Show timeline tracks and clips, and place clips on tracks.
12. Support clip trim, split, and delete.
13. Support playhead movement and timeline preview.
14. Save clip opacity, scale, position, rotation, and volume as local static effects.
15. Include static clip effects in timeline undo, redo, save, and reopen flows, and apply them only to the single active Program Monitor preview.
16. Save keyframes, transitions, and audio track mix settings as local timeline v3 state and evaluate them best-effort in Program Monitor.
17. Export a saved local project timeline to FFmpeg-based MP4 H.264/AAC.

### 3.1.1 Current Local Voice Features

1. Store only reference samples that have explicit user consent.
2. Let the user discard an in-progress sample and delete a saved profile.
3. Mark `local_qwen` TTS as ready only when a local JSON config is provided through `VIDEO_TOOL_TTS_CONFIG_PATH`.
4. Do not download Qwen models or runtimes. The app only calls a user-prepared local wrapper and model path.
5. The local wrapper may target `Qwen/Qwen3-TTS-12Hz-1.7B-Base`, but compatibility and performance require manual verification for the chosen wrapper and runtime.

### 3.2 Not In The MVP

1. Full-screen recording.
2. Simultaneous multi-window recording.
3. Cloud upload.
4. Gemini Veo, OpenAI Sora, or ElevenLabs integration.
5. Final multitrack rendering or frame-perfect mastering guarantees.
6. Account or billing systems.
7. Auto deployment, auto-update, or crash reporting.
8. Preset voice paths such as CustomVoice.
9. Multiple export formats or cloud export.
10. Frame-perfect audio/video mixing.

## 4. User Flows

### 4.1 First Run

1. The user launches the app.
2. The app explains screen and microphone permission needs.
3. The user grants operating system permissions.
4. The app lists recordable windows.
5. The user selects a target window.
6. The app previews the selected window.
7. The user starts recording.
8. The user stops recording.
9. The app shows result file details.
10. The user opens the file or reveals its location.

### 4.2 Permission Denied

1. The user denies Screen Recording permission.
2. The app does not start recording.
3. The app explains how to enable permission in operating system settings.
4. After the user checks permission again, the app refreshes the window list.

### 4.3 Target Window Closed

1. The user selects a window and starts recording.
2. The target window closes while recording.
3. The app stops recording safely.
4. The app checks whether a partial recording file can be saved.
5. The app tells the user that the target window closed.

## 5. Product Structure

### 5.1 Main Screens

| Screen | Purpose | Core Elements |
|--------|---------|---------------|
| Welcome | Explain permissions and the basic flow. | Permission state, start button. |
| Source Picker | Select the window to record. | Window list, thumbnails, refresh. |
| Recorder | Preview and recording controls. | Preview, record, pause, resume, stop, timer. |
| Recording Result | Review the result. | File name, save location, open button. |
| Project Timeline | Edit local assets. | Asset list, tracks, clips, trim, split, delete, clip effects, keyframes, transitions, audio mix, playhead, Program Monitor preview, MP4 export. |
| Settings | Manage basic settings. | Storage path, audio input, quality settings. |

### 5.2 State Model

| State | Description | Allowed Actions |
|-------|-------------|-----------------|
| idle | No selected source. | Select a window. |
| source_selected | A source is selected and preview is ready. | Start recording, change source. |
| recording | Recording is active. | Pause, stop. |
| paused | Recording is paused. | Resume, stop. |
| finalizing | File save is finishing. | Wait. |
| completed | Result file exists. | Open file, start new recording. |
| error | A recoverable error exists. | Retry, change source. |

## 6. Secure Electron Architecture

OpenScene separates renderer, preload, and main process responsibilities. Capture permission and file system access belong to the main process. The renderer does not access Node.js APIs directly.

### 6.1 Principles

1. Keep `nodeIntegration` disabled.
2. Keep `contextIsolation` enabled.
3. The renderer calls only approved APIs through preload.
4. IPC channels need clear names, input schemas, and return types.
5. The main process validates file save paths.
6. External URL loading is blocked by default.
7. API keys must not be exposed to the renderer.
8. Future AI provider calls must run in the main process or a separate backend adapter.

### 6.2 Process Responsibilities

| Area | Responsibility |
|------|----------------|
| main process | Permission checks, source lookup, file writes, local project storage, local FFmpeg jobs, local TTS jobs, provider adapters. |
| preload | Safe typed IPC wrapper exposed as `window.videoTool`. |
| renderer | UI, user input, local editing state, preview state. |
| recorder module | MediaStream handling and recording state. |
| provider adapter | Future provider-specific request and result normalization. |

### 6.3 IPC Contract Draft

| Channel | Direction | Purpose | Input | Output |
|---------|-----------|---------|-------|--------|
| `sources:list` | renderer to main | List recordable windows. | none | `CaptureSource[]` |
| `recording:start` | renderer to main | Start recording session. | `RecordingStartInput` | `RecordingSession` |
| `recording:stop` | renderer to main | End recording session. | `sessionId` | `RecordingResult` |
| `projects:create` | renderer to main | Create local project. | `ProjectCreateInput` | `Project` |
| `projects:saveTimeline` | renderer to main | Save timeline state. | `TimelineSaveInput` | `Project` |
| `assets:import` | renderer to main | Import local media asset. | `AssetImportInput` | `Asset` |
| `export:start-job` | renderer to main | Start MP4 export for saved local timeline. | `StartExportJobInput` | `LocalExportJob` |
| `export:get-job` | renderer to main | Read export state. | `ExportJobActionInput` | `LocalExportJob` |
| `export:cancel-job` | renderer to main | Cancel running export. | `ExportJobActionInput` | `{ cancelled: boolean }` |
| `export:open-result` | renderer to main | Open completed export result. | `ExportJobActionInput` | `{ opened: boolean }` |
| `export:reveal-result` | renderer to main | Reveal completed export result. | `ExportJobActionInput` | `{ revealed: boolean }` |
| `settings:get` | renderer to main | Read settings. | none | `AppSettings` |
| `settings:update` | renderer to main | Save settings. | `Partial<AppSettings>` | `AppSettings` |

## 7. Future Extension Seams

Future features should connect through provider adapters and job models instead of being mixed directly into MVP code. This document defines extension points, but it does not claim Gemini Veo, OpenAI Sora, or ElevenLabs are currently implemented.

### 7.1 Gemini Veo

Goal: create prompt-based video generation jobs and import generated results as project assets after the MVP.

Needed seam:

1. `VideoGenerationProvider` interface.
2. Request model for prompt, aspect ratio, duration, and style preset.
3. Mapping between provider job ids and internal job ids.
4. Polling or webhook handling for generation status.
5. Import path that stores result files in the asset store.

### 7.2 OpenAI Sora

Goal: support Sora-based text-to-video or image-to-video generation as a job-based extension independent from recording.

Needed seam:

1. Shared `VideoGenerationProvider` interface.
2. Provider-specific capability checks.
3. Error model that explains prompt safety outcomes to the user.
4. Structure for connecting generated results to a project timeline or asset list. Provider result import UI is not currently implemented.

### 7.3 ElevenLabs TTS

Goal: turn scripts into speech files and attach them to recorded or generated videos. Cloud ElevenLabs TTS is not implemented. The current TTS path is the separate local Qwen phase.

Needed seam:

1. `TextToSpeechProvider` interface.
2. Request model for voice id, model id, script, and language.
3. Generated audio metadata such as duration, sample rate, and format.
4. Model that links subtitle or script segments to audio segments.

### 7.4 Local Qwen TTS

Goal: use a user-approved local voice sample so a local wrapper can create a Qwen TTS audio asset. This is currently included as a local audio asset extension, not as a cloud API or model download path.

Current boundaries:

1. Provider id is `local_qwen`.
2. Expected model id is `Qwen/Qwen3-TTS-12Hz-1.7B-Base`.
3. Runtime config is read from the JSON file referenced by `VIDEO_TOOL_TTS_CONFIG_PATH`.
4. Executable, model, and working directory paths must be absolute.
5. Wrapper args may receive `{modelPath}`, `{voiceSamplePath}`, `{textPath}`, `{outputPath}`, and `{language}` tokens.
6. OpenScene only runs the wrapper and verifies the result file. Model compatibility, GPU VRAM, memory, and latency are runtime-dependent prerequisites.
7. Voicebox is a reference for local profile workflow. OpenCut is inspiration for local-first asset and timeline UX. Neither is a code dependency or copied source.

## 8. Data Model Draft

The initial implementation is local-file and local-settings first. A database is not required immediately, but model names and relationships should stay clear.

### 8.1 CaptureSource

| Field | Type | Description |
|-------|------|-------------|
| id | string | Source id from the operating system or Electron. |
| name | string | Window title. |
| appName | string | App name. |
| thumbnailPath | string optional | Cached thumbnail path. |
| displayId | string optional | Connected display id. |

### 8.2 RecordingSession

| Field | Type | Description |
|-------|------|-------------|
| id | string | Internal session id. |
| sourceId | string | Selected CaptureSource id. |
| status | RecordingStatus | Current recording status. |
| startedAt | string | ISO timestamp. |
| endedAt | string optional | ISO timestamp. |
| outputPath | string optional | Result file path. |
| durationMs | number optional | Recording duration. |
| errorCode | string optional | Error code. |

### 8.3 RecordingResult

| Field | Type | Description |
|-------|------|-------------|
| sessionId | string | RecordingSession id. |
| outputPath | string | Saved file path. |
| fileName | string | File name. |
| fileSizeBytes | number | File size. |
| durationMs | number | Recording duration. |
| createdAt | string | ISO timestamp. |

### 8.4 GenerationJob

| Field | Type | Description |
|-------|------|-------------|
| id | string | Internal job id. |
| provider | `gemini_veo` or `openai_sora` | Future video generation provider. |
| status | JobStatus | queued, running, completed, failed. |
| prompt | string | Generation prompt. |
| providerJobId | string optional | Provider job id. |
| outputAssetId | string optional | Generated asset id. |
| createdAt | string | ISO timestamp. |
| updatedAt | string | ISO timestamp. |

### 8.5 AudioJob

| Field | Type | Description |
|-------|------|-------------|
| id | string | Internal job id. |
| provider | `elevenlabs` or `local_qwen` | TTS provider. |
| status | JobStatus | queued, running, completed, failed. |
| script | string | Text to turn into speech. |
| voiceId | string | Provider voice id. |
| outputAssetId | string optional | Generated audio asset id. |
| createdAt | string | ISO timestamp. |
| updatedAt | string | ISO timestamp. |

### 8.6 VoiceProfile

| Field | Type | Description |
|-------|------|-------------|
| id | string | Internal voice profile id. |
| displayName | string | User-facing profile name. |
| language | string | Reference sample language. |
| sampleCount | number | Currently 1. |
| totalDurationMs | number | Total saved sample duration. |
| createdAt | string | ISO timestamp. |
| updatedAt | string | ISO timestamp. |

### 8.7 VoiceProfileSample

| Field | Type | Description |
|-------|------|-------------|
| id | string | Internal sample id. |
| voiceProfileId | string | Linked profile id. |
| narrationScript | string | Text used for sample recording. |
| mimeType | audio/webm, audio/wav, audio/mpeg | Saved audio type. |
| consent | explicitConsent true | Explicit consent record. |
| createdAt | string | ISO timestamp. |

### 8.8 Asset

| Field | Type | Description |
|-------|------|-------------|
| id | string | Internal asset id. |
| kind | `recording` or `generated_video` or `tts_audio` | Asset kind. |
| path | string | Local file path. |
| mimeType | string | File type. |
| durationMs | number optional | Media duration. |
| metadata | object | Provider, source, and encoding metadata. |

### 8.9 Project

| Field | Type | Description |
|-------|------|-------------|
| id | string | Internal project id. |
| name | string | User-facing project name. |
| assets | Asset[] | Local assets imported into the project. |
| tracks | TimelineTrack[] | Timeline tracks. |
| playheadMs | number | Current playhead position. |
| updatedAt | string | ISO timestamp. |

### 8.10 TimelineTrack

| Field | Type | Description |
|-------|------|-------------|
| id | string | Internal track id. |
| kind | video or audio | Track kind. |
| clips | TimelineClip[] | Clips placed on the track. |

### 8.11 TimelineClip

| Field | Type | Description |
|-------|------|-------------|
| id | string | Internal clip id. |
| assetId | string | Linked Asset id. |
| trackId | string | TimelineTrack id. |
| startMs | number | Clip start position on the timeline. |
| trimStartMs | number | Trim start inside the asset. |
| trimEndMs | number | Trim end inside the asset. |
| effects | ClipEffects optional | Opacity, scale, position, rotation, and volume as static local effects. |

### 8.12 ClipEffects

| Field | Type | Description |
|-------|------|-------------|
| opacity | number | Clip opacity applied to the single active Program Monitor preview. |
| scale | number | Clip scale applied to the single active Program Monitor preview. |
| position | object | Clip position applied to the single active Program Monitor preview. |
| rotation | number | Clip rotation applied to the single active Program Monitor preview. |
| volume | number | Clip volume in the HTML media volume range from 0 to 1. 1 is 0 dB unity and positive gain is not supported. |

ClipEffects and v3 timeline metadata are local editing values. They take part in undo, redo, save, and reopen flows and are evaluated best-effort in Program Monitor. FFmpeg export currently renders saved timelines to MP4 H.264/AAC, but it does not imply frame-perfect mastering or full multitrack mastering guarantees.

## 9. Roadmap

### Phase 0: Product Foundation

Goal: agree on the plan, security structure, and basic UX.

Done when:

1. This planning document is approved.
2. Selected-window recording MVP scope is fixed.
3. Electron security principles are adopted as implementation rules.

### Phase 1: Selected Window Capture And Preview

Goal: show selectable windows and preview only the selected window.

Done when:

1. The window list appears.
2. Refresh works.
3. The user can select one window.
4. Selected-window preview appears.
5. Permission denial is explained.

### Phase 2: Recording Session

Goal: record the selected window to a file.

Done when:

1. Record, pause, resume, and stop work.
2. Recording state and elapsed time are shown.
3. Result files are saved locally.
4. The result screen shows file metadata.
5. The app stops safely when the target window closes.

### Phase 3: Settings And Stability

Goal: refine storage location, quality settings, and error handling.

Done when:

1. Default storage location can be configured.
2. Recording quality presets can be selected.
3. Error codes and user messages are defined.
4. Memory use is checked for longer recordings.

### Phase 3.5: Local Project Timeline Editing

Goal: edit recording results and imported local assets in a project timeline. This phase is currently included.

Done when:

1. Local projects can be created and saved.
2. Recording results and imported media assets can be added to the project asset list.
3. Timeline shows tracks and clips.
4. Clip trim, split, and delete work.
5. Playhead movement and preview work.
6. Asset, track, clip, trim, and static clip effect state survive save and reopen.
7. Static clip effects apply opacity, scale, position, rotation, and volume in the single active Program Monitor preview.
8. Keyframes, transitions, and audio mix appear as v3 local timeline state and best-effort Program Monitor preview.
9. Saved timelines can be exported with local FFmpeg MP4 H.264/AAC.
10. Multiple export formats, cloud export, final multitrack rendering, and frame-perfect mastering are not presented as implemented.

### Phase 4: AI Generation Seam Preparation

Goal: create structure for provider adapters and job models. Real provider calls require a separate decision and implementation.

Done when:

1. `VideoGenerationProvider` interface design is approved.
2. `TextToSpeechProvider` interface design is approved.
3. GenerationJob, AudioJob, and Asset models are reflected in the implementation plan.
4. API key storage passes security review.

### Phase 4.5: Local Voice Profiles And Local Qwen TTS

Goal: create audio assets from local reference samples and a local Qwen wrapper without a cloud provider. This is currently a local audio asset extension.

Done when:

1. Voice profile samples never start without explicit consent.
2. Samples are stored under Electron `userData` in the local profile store.
3. Users can discard in-progress samples or delete saved profiles.
4. Local TTS is unavailable when `VIDEO_TOOL_TTS_CONFIG_PATH` is missing.
5. When config exists, local wrapper, model path, tokenized args, timeout, and output format are validated.
6. Qwen wrapper output is verified as a non-empty audio file.
7. Manual QA runs a local TTS job with a 10 to 30 second consented sample and verifies result open and reveal.

### Phase 5: Provider Integration Candidates

Goal: decide which provider to connect first among Gemini Veo, OpenAI Sora, and ElevenLabs.

Done when:

1. Provider capabilities and costs are compared.
2. The first expansion type is selected from text-to-video, image-to-video, or TTS.
3. Provider rate limits, policy limits, and failure handling are documented.
4. User-facing job state UX is defined.

## 10. Test Plan

### 10.1 Unit Tests

1. Validate state transitions.
2. Validate saved file name generation.
3. Confirm IPC input validation rejects invalid values.
4. Confirm provider adapter interfaces return shared result types once provider seams are implemented.

### 10.2 Integration Tests

1. Confirm window list requests connect renderer to main process.
2. Confirm selected source id is passed into preview creation.
3. Confirm recording start and stop create result metadata.
4. Confirm permission denial blocks recording start.

### 10.3 Manual QA

1. Launch on macOS without Screen Recording permission.
2. Grant permission and confirm the window list appears.
3. Select one browser window and confirm preview correctness.
4. Record for 10 seconds and confirm the result file plays.
5. Close the target window while recording and confirm the app shows a safe stop message.
6. Switch to another window while recording and confirm only the selected window is captured.
7. Create a local project and import a recording result or local media file as an asset.
8. Place an asset as a clip on a timeline track.
9. Move the playhead and confirm preview follows timeline position.
10. Trim, split, and delete a clip and confirm timeline state changes as expected.
11. Change clip opacity, scale, position, rotation, and volume and confirm they apply only to the single active Program Monitor preview.
12. Use undo and redo and confirm static clip effects change as expected.
13. Save and reopen the project and confirm asset, track, clip, trim, and static clip effect state persists.
14. Confirm keyframes, transitions, and audio mix appear in Program Monitor as best-effort preview.
15. Configure FFmpeg through `VIDEO_TOOL_FFMPEG_PATH` or absolute `PATH` discovery, start MP4 export, and confirm queued or running progress.
16. Cancel a running export and confirm partial output is discarded and UI shows cancelled state without a path.
17. Complete an MP4 export and confirm open and reveal work while renderer does not display output path, FFmpeg path, or argv.
18. Confirm UI does not present multiple export formats, cloud export, final multitrack rendering, frame-perfect mastering, or AI video providers as implemented.
19. With `VIDEO_TOOL_TTS_CONFIG_PATH` missing, confirm local TTS runtime is unavailable.
20. Prepare a real local wrapper config with absolute paths and save a 10 to 30 second consented reference sample.
21. Run a local Qwen TTS job and confirm output audio is created and open and reveal work.
22. Delete the voice profile and confirm sample files and metadata disappear from local profile storage.

## 11. Acceptance Criteria

### AC 1: Window Selection

Given the app has Screen Recording permission.
When the user opens Source Picker.
Then the app shows the current selectable desktop window list.

### AC 2: Selected Window Preview

Given the user selected one window from the list.
When selection completes.
Then the app shows only the selected window preview.

### AC 3: Recording Start

Given preview is ready.
When the user presses record.
Then the app switches to recording state and shows elapsed time.

### AC 4: Recording Stop And Save

Given the app is recording.
When the user presses stop.
Then the app stops recording and creates a local result file.

### AC 5: Result Review

Given the recording file was created.
When save completes.
Then the app shows file name, save location, file size, and duration.

### AC 6: Permission Denied

Given Screen Recording permission is missing.
When the user tries to start recording.
Then the app does not start recording and shows permission guidance.

### AC 7: Target Window Closed

Given the app is recording a selected window.
When the target window closes.
Then the app stops safely and tells the user why.

### AC 8: AI Provider State

Given the app is in MVP state.
When the user looks for Gemini Veo, OpenAI Sora, or ElevenLabs features.
Then the app must not present those features as implemented.

### AC 8.1: Local Project Creation And Asset Import

Given the user created a local project.
When the user imports a recording result or local media file.
Then the app displays it as a project asset and stores metadata locally.

### AC 8.2: Timeline Track And Clip Placement

Given a project asset exists.
When the user adds the asset to the timeline.
Then the app shows a clip on a track.

### AC 8.3: Clip Trim, Split, Delete

Given the timeline has a clip.
When the user trims, splits, or deletes it.
Then the app updates and can save local timeline state.

### AC 8.4: Playhead And Preview

Given the timeline has a clip.
When the user moves the playhead.
Then the app shows the current playhead position and updates preview.

### AC 8.5: Local MP4 Export

Given the user opened a saved local project and FFmpeg is available.
When the user starts MP4 export.
Then the app provides queued, running, completed, progress, cancel, open, and reveal states without exposing paths to the renderer.

### AC 8.6: Static Clip Effects Save And Preview

Given the timeline has a clip.
When the user changes opacity, scale, position, rotation, or volume.
Then the app stores values in local timeline state and preserves them through undo, redo, save, and reopen.

### AC 8.7: Static Clip Effect Boundaries

Given a clip has static effects.
When the user checks preview.
Then the app evaluates effects, keyframes, transitions, and audio mix best-effort in the single active Program Monitor preview and must not present frame-perfect mastering or multiple export formats as implemented.

### AC 9: Local Voice Profile Consent

Given the user tries to create a voice profile sample.
When `explicitConsent` is not true.
Then the app must not start sample storage.

### AC 10: Local Qwen TTS Config

Given `VIDEO_TOOL_TTS_CONFIG_PATH` is not set.
When the user checks local TTS status.
Then the app reports the `local_qwen` provider as unavailable.

### AC 11: Local Qwen TTS Execution

Given the user prepared an absolute-path local wrapper config and a consented voice profile.
When the user starts a TTS job.
Then the app calls the wrapper and displays generated audio asset metadata.

## 12. Verification Standard

The product is decision-ready when:

1. The MVP focus on selected-window capture, recording, and local project timeline editing is clear.
2. Gemini Veo, OpenAI Sora, and ElevenLabs are documented as future extensions only.
3. Electron security rules are specific enough for implementation.
4. The data model describes recording, local project timeline work, and future generation jobs.
5. The roadmap grows from capture and recording into local timeline editing and provider seams.
6. Test plan and acceptance criteria are specific enough to judge implementation completion.
7. Local voice profiles and local Qwen TTS are documented as local audio asset extensions, not cloud provider work.
8. Voicebox, OpenCut, and Qwen reference boundaries cannot be confused with dependencies or copied code.
9. Static clip opacity, scale, position, rotation, and volume are stored as local editing values and applied only to the single active Program Monitor preview.
10. Keyframes, transitions, audio mix, and local MP4 H.264/AAC export are documented as implemented scope, while multiple export formats, cloud export, final multitrack rendering, frame-perfect mastering, and AI video providers remain future work.

## 13. Decisions Still Needed

1. Final timeline export is currently MP4 H.264/AAC. Additional formats require a separate decision.
2. Decide whether to support macOS first or Windows at the same time.
3. Decide whether system audio belongs in the MVP or whether microphone audio is enough.
4. Choose provider expansion order among Gemini Veo, OpenAI Sora, and ElevenLabs.
5. Decide whether to publish a support matrix for recommended local Qwen wrapper runtime, GPU VRAM, and memory.

## 14. Summary Decision

The implementation started with capture and recording. The current product value is that a user can select one desktop window, record only that window safely to a local file, and then use imported assets, tracks, clips, trim, split, delete, clip effects, keyframes, transitions, audio mix, playhead, preview, and MP4 export in a local project timeline. Clip effects and v3 timeline values are stored locally and take part in undo, redo, save, and reopen flows. Program Monitor is a best-effort preview surface. Saved timelines can be exported locally through FFmpeg as MP4 H.264/AAC. AI video generation and cloud TTS are part of the product direction, but not MVP implementation scope. Multiple export formats, cloud export, final multitrack rendering, and frame-perfect mastering remain future work. Local voice profiles and local Qwen TTS are documented as local audio asset extensions. The structure is designed to grow through provider adapters and job models.

## 15. Compatibility Identifiers

These identifiers must stay unchanged even when user-facing product prose uses OpenScene:

- `window-loom-theme`
- `window-loom-editor-layout`
- `window-loom-editor-shortcuts`
- `application/x-window-loom-timeline`
- `VIDEO_TOOL_*`
- `window.videoTool`
- `local_qwen`
