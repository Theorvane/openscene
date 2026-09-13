# Manual storyboard production board

Issue: [#329](https://github.com/Theorvane/openscene/issues/329)

## Outcome

- The board is a projection of the approved Writer scenes, shots, references, generation attempts, and review decisions already stored in the project. It is not a second workflow manifest.
- Imported PNG, JPEG, and WebP project images can be assigned as a shot's storyboard/first frame. Up to three project images can be assigned to each character profile.
- Opening a shot loads its approved prompt and duration. It loads the storyboard first frame when one exists; otherwise it can load the scene's saved character-reference set when the selected model supports reference-to-video.
- Each row reports not started, generating, needs import, needs review, approved, or failed from persisted state.
- Assembly is an explicit action and succeeds only when every Writer shot has one completed, imported, approved video candidate with metadata. It appends the videos in Writer order and refuses partial or duplicate placement.

## Manual and provider boundaries

The board never invokes a provider. Prompt review, input-mode choice, generation, import, continuity review, approval, assembly, timeline save, and export remain separate creator actions.

Current provider modes accept either a storyboard first frame or a character-reference set. The UI states that limitation instead of silently dropping one input group.

## Shared surfaces

Desktop provides mapping, shot opening, and assembly. Its character library only includes characters used by the active approved Writer version, so superseded scripts do not pollute the current production board. Mobile renders the same derived board and uses the same assembly plan/placement functions. Mobile states that imported storyboard/character mapping is currently managed on desktop; it does not pretend its session-only image picker has persisted a project mapping.

## Safety

- Project images are reopened through the confined asset store and cross the preload bridge as bounded base64 bytes without a path.
- Assembly refuses missing video metadata, non-video outputs, incomplete approval, one output reused by multiple shots, existing approved assets on the timeline, overlaps, and duplicate clip IDs.
- A failed assembly leaves the original timeline unchanged.

## Verification

- Focused production, parity, and project-image tests: 16/16 passing.
- Root production build/typecheck and mobile typecheck: passing.
- Full suite: 1,265/1,289 passing; the remaining 24 are the pre-existing Windows CRLF, symlink-permission, FFmpeg, and source-assertion failures. No test added for this phase fails.
- Electron development smoke loaded main, preload, renderer, and the managed VieNeu runtime. Interactive browser visual QA was unavailable in this environment, so it is not claimed.
