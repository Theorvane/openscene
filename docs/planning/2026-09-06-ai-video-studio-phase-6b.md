# AI Video Studio Phase 6B — managed local AI runtimes

**Issue:** #325
**Branch:** `feat/325-managed-local-ai-runtimes`
**Stacked base:** `feat/324-local-whisper-subtitles`

## Outcome

One OpenScene launch now owns the local speech/subtitle dependencies needed by the desktop workflow. Users run a one-time verified setup command; they no longer open a separate VieNeu terminal or paste Whisper paths for the standard checkout layout.

## One-time setup

```powershell
npm run setup:local-ai
```

The PowerShell installer:

- downloads official `ggml-org/whisper.cpp` Windows x64 release `b4938` and verifies archive SHA-256 `c2a4b60edb11f7e11a9191ffb50929535527d4d91c9903dbe3e554583bbbc63d`;
- downloads official multilingual `ggml-small.bin` from pinned repository commit `5359861c739e955e79d9a303bcbc70fb988958b1` and verifies SHA-256 `1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b`;
- optionally installs the official CUDA 12.4 archive when `OPENSCENE_WHISPER_CUDA=true`; the current GTX 1650 keeps the CPU build because a real sample benchmark measured roughly 6.6 seconds on CPU versus 44.1 seconds with the generic CUDA build;
- installs those files under ignored `.local-runtimes/`, never source control;
- runs `uv sync` against a sibling `VieNeu-TTS` checkout (or `OPENSCENE_VIENEU_PROJECT_DIR`) so its `.venv` is ready.

The current managed Whisper footprint is about 493 MB. VieNeu's Python environment is separate; model cache size depends on its upstream release and first launch.

## Runtime lifecycle

- Whisper is not a resident server. Each transcription job launches `whisper-cli` directly and exits when the SRT result is ready.
- OpenScene begins warming VieNeu in the background after the Electron window opens. Voice discovery and synthesis also call the same `ensureReady` gate, so they wait rather than racing startup.
- A healthy server already listening on the configured loopback URL is reused and never killed by OpenScene.
- A server launched by OpenScene uses the checkout's exact virtual-environment Python, `shell: false`, a hidden Windows process, piped diagnostics and a ten-minute bounded readiness wait.
- The child receives an environment allowlist for OS paths, cache/proxy/locale and documented VieNeu controls. Gemini, AgentRouter and other provider credentials are not inherited by Python.
- App shutdown terminates only the child process OpenScene launched.

## Overrides and recovery

Explicit Whisper executable/model environment paths still take precedence and must be supplied as a pair. `OPENSCENE_WHISPER_MODEL_SHA256` verifies custom model files.

VieNeu defaults to a sibling checkout and `http://127.0.0.1:8001`. Set `OPENSCENE_VIENEU_PROJECT_DIR` for another absolute checkout, or `OPENSCENE_VIENEU_AUTOSTART=false` when managing the server yourself. Terminal events use the `[OpenScene][VieNeu Runtime]` prefix and never include narration text.

Local runtime execution remains desktop-only. Mobile keeps this limitation visible and continues to share review/edit/apply contracts where applicable.
