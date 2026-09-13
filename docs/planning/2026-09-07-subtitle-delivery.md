# Reviewed subtitle delivery

Issue: [#330](https://github.com/Theorvane/openscene/issues/330)

## Outcome

- Desktop export now makes automatic-caption delivery explicit: burn approved automatic captions into the MP4, create one optional SRT/WebVTT/ASS sidecar, do both, or do neither.
- Manual timeline titles are never removed by the automatic-caption burn choice.
- Sidecars are generated deterministically from the automatic caption titles already applied to the authoritative timeline. A requested sidecar with no applied automatic captions is refused before an export job is created.
- The completed job reports only the generated MP4 and sidecar filenames. The renderer still receives no output path, FFmpeg path, or arguments; Reveal opens the app-owned export folder containing both files.

## Shared contract

`src/shared/subtitleDelivery.ts` owns caption selection, the burn-in timeline projection, delivery validation, and UTF-8 SRT/VTT/ASS serialization. Desktop and mobile both call the same burn-in projection.

The delivery contract is bounded to 5,000 cues, 500 characters per cue, and two hours. WebVTT markup and ASS override syntax are neutralized so caption text cannot become subtitle control syntax.

## Output lifecycle and safety

- The MP4 process must complete and its contained output must validate before a sidecar is written.
- Sidecar names are generated from the validated job ID; no renderer-controlled filename or path crosses IPC.
- Files use create-new semantics and no-follow validation, so an existing file or symlink is never overwritten.
- A sidecar write/validation failure fails the whole job and removes the partial MP4 and any sidecar created by that attempt.
- Existing exports without `subtitleDelivery` retain their behavior: all timeline titles are burned and no sidecar is created.

## Mobile boundary

Mobile uses the same shared decision to include or omit automatic captions from its native composition. Its More menu makes that choice visible. SRT/VTT/ASS file delivery is explicitly disabled because the mobile delivery path currently saves one MP4 to Photos or a share sheet; it does not silently promise a second file.

## Verification

- Focused subtitle/export/renderer contract suite: 24/24 passed.
- Root TypeScript check and production Electron build passed.
- Mobile TypeScript check passed.
- Full root suite: 1,274/1,298 passed. The remaining 24 failures are the existing Windows CRLF, symlink-permission, FFmpeg/source-fixture, and source-assertion baseline; no subtitle-delivery test failed.
- Electron development smoke loaded main, preload, renderer, and the managed VieNeu runtime; shutdown released ports 5173 and 8001. Interactive visual QA was not claimed in this terminal-only run.

## Deferred

- style presets and safe-area controls;
- word-level karaoke and forced alignment;
- speaker diarization and translation;
- audio ducking and loudness normalization.
