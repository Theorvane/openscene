# AI Video Studio Phase 6A — reviewed local automatic subtitles

**Issue:** #324  
**Branch:** `feat/324-local-whisper-subtitles`  
**Stacked base:** `feat/323-comfyui-motion-control`

## Outcome

OpenScene can transcribe an imported project audio or video asset with a local `whisper.cpp` CLI, keep the result as a reviewable project draft, and apply only an explicitly approved transcript to the timeline. This complements the existing deterministic Writer/narration captions with timing measured from real audio.

## Workflow

1. Import an audio or video asset and wait for its project asset record to be ready.
2. In Voice Generation, select the source and spoken language.
3. Start transcription. Main securely opens the project asset, copies bytes from the validated file handle into a private temporary directory, and normalizes them with FFmpeg to mono 16-bit 16 kHz WAV.
4. `whisper-cli` writes SRT in that private directory. OpenScene parses bounded, ordered, non-overlapping segments into the shared transcript contract.
5. Review and edit every text/timing cue. Save a draft or approve it deliberately.
6. Place the source asset on the timeline, then apply the approved transcript. Source timestamps are mapped through clip trim, timeline offset and playback speed. Prior automatic captions are replaced; manual titles are preserved. Save the timeline separately after visual review.

## Runtime boundary

Phase 6B adds a one-time, checksum-verified managed runtime installer. Run this from the OpenScene checkout:

```powershell
npm run setup:local-ai
```

OpenScene then discovers `.local-runtimes/whisper.cpp/b4938` automatically. Binaries and weights are ignored by Git and are not bundled in commits. Advanced users may still override both absolute paths in the local `.env`:

```dotenv
OPENSCENE_WHISPER_CPP_PATH=D:\whisper.cpp\build\bin\Release\whisper-cli.exe
OPENSCENE_WHISPER_MODEL_PATH=D:\whisper.cpp\models\ggml-small.bin
OPENSCENE_WHISPER_MODEL_SHA256=<64-character sha256>
```

The managed installer pins the official Windows x64 release `b4938` (`whisper.cpp 1.9.3`) and the official multilingual `ggml-small.bin` object at model-repository commit `5359861c739e955e79d9a303bcbc70fb988958b1`. It verifies the GitHub release archive and model SHA-256 before installation. The configured CLI must support `--version`, `-m`, `-f`, `-l`, `-osrt`, `-of`, and `-pp`.

For the current GTX 1650 4 GB machine, start with a multilingual `base` or `small` model. The upstream memory table estimates roughly 388 MB for base and 852 MB for small; actual runtime, GPU offload and transcription speed still depend on the build and media length. The app never claims a model is accurate without listening and correcting the result.

To calculate the optional deployment checksum in PowerShell:

```powershell
(Get-FileHash -Algorithm SHA256 'D:\whisper.cpp\models\ggml-small.bin').Hash.ToLower()
```

## Failure and privacy behavior

- Renderer and persisted jobs never receive absolute source, executable, model or temporary paths.
- Missing runtime, invalid model checksum, missing source, FFmpeg failure, malformed/overlapping SRT, timeout and cancellation all end in a terminal job state.
- Terminal logs include job ID, stage, percentage, elapsed time, model/executable basenames and safe byte counts, but no transcript text or private paths.
- FFmpeg normalization is bounded to ten minutes and recognition to sixty minutes. UI polling has its own 65-minute deadline and cancels the local job.
- Temporary files are removed with Windows retry handling after process/file handles close.

## Surface parity

Desktop owns local execution because Electron main can open the validated asset and launch managed local executables. Mobile visibly states that generation is desktop-only, but uses the same shared transcript contract to edit, approve and apply a transcript already saved in the project.

## Deferred scope

- word-level karaoke highlighting and DTW alignment;
- speaker diarization and multi-speaker caption styling;
- glossary/prompt controls and per-range retranscription;
- SRT/VTT/ASS sidecar import/export;
- subtitle style presets and safe-area controls.

Those are separate changes. Phase 6A provides segment-level timestamps and a review gate; it does not label them word-level alignment.
