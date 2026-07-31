# Domain-specific AI workspaces and OpenCode-style Edit Agent

**Status:** Proposed — awaiting specification review

**Date:** 2026-07-26

**Issue:** #44

## 1. Objective

OpenScene will expose three distinct AI domains rather than one global AI-model setting:

1. **Voice Studio** selects a text-to-speech-capable execution model/provider.
2. **Video Studio** selects a video-generation-capable execution model/provider.
3. **Edit Agent** selects a tool-calling language model and uses LangGraph to convert natural-language edit requests into reviewable OpenScene timeline actions.

The local project and timeline remain the source of truth. AI may propose, generate, import, or execute approved operations; it must not silently overwrite project state or replace direct editing.

## 2. Current facts and non-negotiable boundaries

The initial implementation must reflect the actual capability state of the repository:

| Domain | Available now | Declared but unavailable now |
| --- | --- | --- |
| Voice generation | User-configured Local Qwen TTS runner | ElevenLabs adapter |
| Video generation | User-configured Local Video Runner | Gemini Veo, OpenAI Sora, Runway, Kling, Luma adapters |
| Edit Agent | User-configured Ollama model with LangGraph tool calling | Cloud tool-calling adapters |

The app already has typed boundaries for `aiGenerateSpeech`, `aiGenerateVideo`, job polling, result import, TypeMCP tools, and LangGraph approval interrupts. The implementation must extend those boundaries rather than add raw renderer filesystem access or a parallel project model.

Credentials remain in the Electron main-process safe-storage path. The renderer may display only credential-presence state and provider metadata; it must never write secrets to localStorage, logs, plans, tool results, or project files.

## 3. Architecture

### 3.1 Domain configuration contract

Add a shared `AiDomain` contract:

```ts
type AiDomain = 'voice-generation' | 'video-generation' | 'edit-agent';

type AiDomainModelPreference = {
  domain: AiDomain;
  providerId: string;
  modelId: string;
  executionPath: 'local' | 'api';
};
```

A domain preference is not a credential. It contains only safe provider/model identifiers and an execution-path choice. Preferences persist locally under a new versioned localStorage key, while secrets continue through the existing credential bridge.

Each provider/model catalog entry declares its supported domains and availability. Selectors filter by domain. A model cannot be chosen for a domain it does not support, including through stale persisted settings.

### 3.2 Separate catalogs, shared provider metadata

The current broad LLM catalog is insufficient for generation engines. Split safe display metadata into three catalog families:

- `VoiceGenerationModelConfig`: provider, model ID, labels, supported language/voice options, execution path, availability, unavailable reason.
- `VideoGenerationModelConfig`: provider, model ID, labels, supported aspect ratios/duration limits, execution path, availability, unavailable reason.
- `EditAgentModelConfig`: provider, model ID, tool-calling capability, execution path, availability, unavailable reason.

Provider credentials and endpoint information can remain shared where appropriate (for example, an OpenAI credential), but domain selection is independent. The UI does not imply that a configured credential makes an unimplemented adapter usable.

### 3.3 Main-process resolution

The main process resolves a selected provider/model from the corresponding domain catalog before it starts a job or creates an agent model. It rejects unavailable or cross-domain selection with a typed error.

Existing local runners remain user-configured through main-process environment/runtime configuration. OpenScene will not download model weights, infer a model name from an arbitrary executable, or claim a local runner supports a specific model unless the configured runner contract confirms it.

## 4. Workspace design

### 4.1 Voice Studio

Voice Studio keeps its existing profile/consent workflow and receives a **Voice model** card:

- execution path (currently Local Qwen; unavailable cloud entries are visible but disabled with reasons);
- model/provider selector constrained to the voice catalog;
- voice/profile, language, output format, and narration script controls;
- safe runtime/credential readiness state;
- generation job status and a completed-result action.

A completed voice result follows the existing project-import flow. After import, the UI offers **Send to Edit Agent**. This sends an asset reference and safe metadata (asset ID, label, media kind, duration) to the Edit Agent context. It does not send a raw output path.

### 4.2 Video Studio

Video Studio keeps its prompt, style, aspect-ratio, duration, polling, and project-import workflow. It receives a **Video model** card constrained to the video catalog:

- Local Video Runner is enabled only when runtime validation says it is configured.
- Cloud entries show a disabled unavailable state until the corresponding adapter is implemented.
- Provider/model identifiers are included in the typed generation request and resulting safe job metadata.

A completed video is imported through the existing result-asset import service. After import, **Send to Edit Agent** passes the imported project asset reference to the agent context.

### 4.3 Edit Agent Workspace

The existing persistent side chat remains the universal interaction surface. The editor additionally receives an **Edit Agent workspace** for full OpenCode-style work without replacing the timeline.

The workspace has four explicit regions:

1. **Model & connection** — Edit Agent provider/model selector, local endpoint state, capability/readiness display, and connection test. Only tool-calling-capable configured models are selectable.
2. **Conversation and execution stream** — natural-language requests, assistant responses, generated step plan, tool proposals, execution output, errors, and reset action. Raw secret values and raw local file paths are never rendered.
3. **Approval queue** — every action that writes a project, starts a generation job, or exports waits here for explicit approval. A denied request becomes an auditable tool result; it does not mutate the project.
4. **Project context** — active project summary, selected timeline item where available, and imported/generated assets that the user has explicitly attached. Users can remove context before prompting.

The agent is OpenCode-like in its model configuration and transparent tool-run execution, not in its product scope: it controls only OpenScene's approved, typed tool set and not arbitrary shell commands, filesystem access, or network actions.

## 5. Asset handoff and prompt workflow

### 5.1 Handoff sequence

1. A user creates a voice or video generation job with the selected domain model.
2. The job completes or fails through the existing typed job lifecycle.
3. The user imports a completed result into the active local project.
4. The import service returns a project asset ID and safe metadata.
5. The user presses **Send to Edit Agent**, attaching that project asset reference to the agent context.
6. The user asks an edit request, for example: “Put the generated city shot at the start, trim it to five seconds, fade it in, then place the narration beneath it.”
7. LangGraph produces a plan and one or more typed tool proposals.
8. The user approves or rejects the proposals.
9. Approved tools update the local project store. The existing timeline reflects the new saved state.

### 5.2 Tool expansion

The first implementation extends the current TypeMCP tool set in focused layers:

1. inspect active project/timeline and attached asset metadata (read-only);
2. add an imported video/audio asset to an appropriate timeline track;
3. adjust clip start, duration, and supported basic effects through validated timeline commands;
4. run existing export workflow.

Each write tool is in `AGENT_CHAT_MUTATING_TOOL_NAMES` and therefore passes the existing LangGraph interrupt/approval gate. Destructive operations, asset deletion, arbitrary commands, and arbitrary file reads are explicitly out of scope.

## 6. State, failure, and concurrency behavior

- Domain selections persist independently and fall back to a valid available model if a stored selection becomes unavailable.
- Generation and agent jobs display queued/running/completed/failed state without exposing provider secrets.
- Main-process provider validation fails closed for unavailable adapters, absent local runners, missing credentials, invalid domain/model combinations, or invalid asset references.
- Renderer IPC rejections must always clear busy state and preserve the existing recovery behavior.
- While the Edit Agent turn or an approved tool is running, the existing non-chat workspace lock remains active. The conversation, approval controls, and failure recovery controls stay usable.
- Multiple asset handoffs are explicit context attachments; the agent never assumes every generated job belongs to the next edit request.

## 7. Accessibility and UX requirements

- Domain selectors use labels, descriptions, keyboard-operable controls, and selected state semantics.
- Unavailable provider/model options explain why they cannot be used; availability is not communicated only by color.
- Tool plans, pending approvals, job state, context attachments, and errors are exposed through accessible live/status text.
- The visible non-chat lock message remains hidden from accessibility APIs while its sibling live announcement stays outside the inert tree.
- The direct timeline remains usable without an AI model and stays visually primary.

## 8. Testing and verification

Implementation begins with failing tests for:

1. independent voice/video/edit-agent preference persistence and catalog filtering;
2. rejection of cross-domain/unavailable model selection in main-process requests;
3. generation requests carrying only safe provider/model IDs;
4. completed-result import returning an asset reference that can be attached to agent context;
5. read-only tool inspection vs. approval-required mutations;
6. approved add/trim/effect commands updating only the intended local timeline state;
7. rejected, failed, and IPC-rejected requests releasing the busy lock;
8. selector, approval queue, status, and lock accessibility contracts.

Required verification for each implementation PR:

```bash
npm test
npm run typecheck
npm run build
git diff --check
```

CI and independent review must pass before merge.

## 9. Delivery slices

The work is intentionally split to keep each PR reviewable:

1. **Domain model configuration foundation:** shared catalogs/preferences, safe persistence, settings UI, and tests.
2. **Voice and video integration:** domain selectors in existing studios, typed request metadata, asset import and explicit Edit Agent handoff.
3. **Edit Agent workspace:** OpenCode-style model/configuration surface, context attachments, planning/execution stream, and approvals.
4. **Timeline tool expansion:** read-only inspection and approved add/trim/basic-effect operations with focused state validation.

Each slice remains independently useful and must not activate unavailable cloud adapters.

## 10. Non-goals

- Implementing cloud video, cloud TTS, or cloud tool-calling adapters in this scope.
- Replacing direct timeline editing, the project store, FFmpeg export, or the persistent agent chat.
- Executing arbitrary shell commands, filesystem operations, or provider HTTP calls from the renderer or agent.
- Automatically importing generated output into an edit request without the user attaching project asset context.
- Moving credentials or generated media into analytics, accounts, remote synchronization, or hidden storage.
