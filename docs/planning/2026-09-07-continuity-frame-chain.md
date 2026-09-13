# Continuity frame chain

Issue: [#328](https://github.com/Theorvane/openscene/issues/328)

## Outcome

- Approved Writer shots now expose their persisted `AiShot` ids, so candidate records cannot point at synthetic UI-only ids.
- An approved, imported candidate can materialize a near-tail JPEG and attach it as the immediately following Writer shot's `start_frame` reference.
- The next candidate records only references that were actually loaded into its provider request.
- The approved Style Bible replaces the free-form visual preset while a Writer shot is loaded and is re-applied to the final provider prompt after every manual edit or refinement.

## Trust boundary

- The renderer sends only `projectId` and `assetId`.
- Main reopens the asset through `AssetLibraryStore`, stages it from the validated file handle, invokes FFmpeg without a shell, and imports the result through the normal project transaction.
- The bridge returns bounded JPEG bytes and project metadata, never an absolute path.
- Temporary files use a private directory and bounded Windows cleanup retries. A timed-out FFmpeg process is cancelled and allowed to release its file handles before cleanup. Logs include ids, byte counts, duration, and stages; they exclude paths and image bytes.
- Tail extraction starts 100ms before the probed end, then falls back to 500ms and 1500ms guards for containers whose duration is rounded. The imported still does not inherit the source video's dimensions because FFmpeg may scale it down.

## Human gate

The chain action exists only after candidate approval. It does not generate the next shot automatically: it fills the next approved Writer prompt, duration, style lock, and first frame for review. A saved frame must be explicitly loaded again after reopening the project.

## Compatibility

Project schema versions do not change. `image` was already part of `MediaKind` and still-image timeline/export logic; this change completes its shared parser and deterministic `.png/.jpg/.jpeg/.webp` project-asset support. Existing video/audio assets retain their paths and behavior.

Mobile keeps its existing native sequential tail-frame extraction. It shares the corrected persisted Writer shot ids and continuity-domain rules; local FFmpeg extraction remains desktop-only.
