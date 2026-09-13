# Caption Studio with cross-renderer safe-area styles

Issue: [#331](https://github.com/Theorvane/openscene/issues/331)

## Outcome

- A backward-compatible `TimelineTitle.style` stores materialized renderer-safe values: regular/bold weight, outline colour/width, background colour/opacity, padding and free/top/center/bottom placement.
- Clean outline, readable box, cinema and social presets change appearance only. They do not change title identity, words or timing.
- A reviewed appearance can be applied to every automatic narration/transcription caption in one undoable operation. Manual titles remain untouched.
- Reapplying narration or Whisper captions keeps the previous automatic-caption appearance instead of resetting a user's styling work. New caption tracks begin with the Clean outline preset.
- Safe anchors resolve from the actual output height, so portrait, landscape and square exports keep captions inside the title-safe region; X/Y remain fine offsets.

## Renderer agreement

- Desktop Program Monitor observes the project's export-frame choice and uses shared preview scaling, style resolution and anchor placement.
- FFmpeg burn-in uses the matching regular/bold system face plus `drawtext` outline, box, opacity and padding options.
- Mobile preview receives the actual selected frame dimensions. The native bridge receives already-resolved output coordinates and materialized style values.
- Android Media3 renders weight, a per-line padded background and a centred outline shadow. iOS uses CoreText fill/stroke and a measured, padded Core Animation text layer.
- ASS sidecars materialize per-cue font, colour, outline/box and position. SRT and WebVTT intentionally remain portable plain-text subtitle formats.

## Compatibility and boundaries

- An absent style means the old regular, unboxed, free-position title; existing projects remain readable and are not silently restyled.
- Style validation rejects unknown keys, invalid colours, non-finite values and values outside the bounded outline/opacity/padding ranges.
- Custom font upload or embedding is intentionally deferred: arbitrary renderer paths do not belong in a shared project document, and a font needs licensing plus deterministic fallback work before it can be portable.
- Android's Media3 text path approximates a uniform outline with a centred text shadow. Device-level golden-frame comparison remains a release gate; this Windows run can typecheck the bridge and inspect native source but cannot compile iOS or run either device renderer.

## Verification

- Focused shared/FFmpeg/renderer/workflow suite: 65/65 passed across 10 files.
- A real FFmpeg 9.0.1 render produced a non-empty MP4 using a bold system font, translucent padded box and title-safe anchor.
- Root TypeScript check and production Electron build passed.
- Mobile TypeScript check passed.
- Full root suite: 1,284/1,308 passed. The remaining 24 failures are the established Windows CRLF, symlink-permission, FFmpeg/source-fixture and source-assertion baseline; no Caption Studio test failed.
- Electron development runtime rebuilt through HMR without a renderer error and VieNeu remained ready. No controllable browser or mobile development client was connected, so interactive visual/device QA is not claimed.
