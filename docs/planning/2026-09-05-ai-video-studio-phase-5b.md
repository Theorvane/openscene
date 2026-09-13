# AI Video Studio Phase 5B — synchronized detached audio

**Issue:** [#321](https://github.com/Theorvane/openscene/issues/321)  
**Branch:** `feat/321-detach-video-audio`

## Goal

Let an editor turn the native sound in a selected video clip into an independently editable audio clip without changing timing or hearing the stream twice.

## Delivered contract

- Desktop Inspector exposes **Audio → Detach audio** for video clips.
- Main owns FFmpeg discovery, process execution, timeout, temporary storage and asset import.
- The renderer never receives an absolute filesystem path.
- The validated source is copied through its already-open file handle before FFmpeg reads it, closing the path-swap window.
- The WAV is padded to the video duration so delayed or short embedded streams retain source-time alignment.
- One shared timeline transaction carries timeline start, source in/out, speed, base volume and volume keyframes to the new audio clip.
- The source video base volume and volume keyframes are muted in that same transaction, preventing duplicate sound.
- An existing non-overlapping audio track is reused; otherwise a new audio track is created.
- Captions remain independent `TimelineTitle` entries and continue to be applied from the reviewed narration workflow.
- Desktop logs request, staging, FFmpeg progress, import, failure category and cleanup without logging media paths or content.

## Honest platform boundary

The current mobile native compositor can mix audio but exposes no API that writes a video stream out as a standalone audio file. Mobile therefore displays **Detach audio** disabled with the reason on screen; embedded video sound continues to preview and export normally.

## Not claimed

Detaching audio is not speech recognition. A generated/imported video with no approved narration does not automatically acquire subtitles. Word-level transcription and alignment require a separately reviewed ASR provider/model workflow; deterministic Writer/narration captions remain the current subtitle source.

## Verification

- Real local FFmpeg extraction from an MP4 containing AAC audio.
- Unit coverage for trim, speed, volume automation, embedded-audio muting and collision-driven audio-track creation.
- IPC/surface parity coverage for main, preload, desktop and the explicit mobile limitation.
- Desktop typecheck and production build.
- Mobile typecheck.
- Related audio, composition, FFmpeg compiler and subtitle regression tests.
