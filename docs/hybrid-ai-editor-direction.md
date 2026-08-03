# OpenScene hybrid AI editor direction

**Status:** Historical direction plus future assisted-editing constraints. Provider-backed voice, image, video generation, and the approval-gated Edit Agent are now released; the AI-assisted editing proposals in §3.1 remain future work.
**Date:** 2026-07-23
**Issue:** #12

> **Current capability source:** [the root README](../README.md) is the public current-capability and release boundary. This document preserves the initial hybrid-AI direction and defines constraints for capabilities that remain unimplemented.

## 1. Decision

OpenScene will evolve into an open-source **hybrid AI video editor**. The local timeline remains the primary workspace and system of record. AI supports the creator with proposed edits and optional generated assets; it does not replace human review, local project ownership, or the existing local export path.

The product supports two future, user-controlled AI paths:

1. **Local model path** — a user-configured local model performs a supported operation on the user's device.
2. **Connected service path** — a user explicitly selects and authorizes an external AI service for one requested operation.

This document defines direction and architectural constraints only. It does not authorize a provider adapter, cloud storage, account system, telemetry, model download, secret-storage solution, or a runtime product claim that AI features are available.

## 2. Product principles

### 2.1 The local editor is primary

Recordings, imported media, project state, timeline edits, renderable assets, and exports remain local by default. The timeline must remain useful if the user never configures a model or connects a service.

### 2.2 AI output is reviewable material

AI operations return suggestions, candidate edits, or optional assets. Before they affect a saved timeline, users review, edit, accept, reject, or delete them through normal editor workflows. An AI operation must not silently mutate a saved timeline.

### 2.3 Connections are explicit

Before an external request, OpenScene must make the following information visible in the initiating workflow:

- the service or model selected for the operation;
- the operation being requested;
- the material that will leave the device, including whether it is a clip, frame, audio segment, transcript, prompt, or project metadata;
- the user action that begins the request; and
- a route to cancel a queued or in-progress request where the provider permits cancellation.

A remote provider must never be selected implicitly, used in the background, or represented as local processing.

### 2.4 Local model setup stays user-controlled

OpenScene may support a user-provided local runtime through typed configuration and verified executable/model paths. It must not download models or runtimes automatically, promise compatibility, or expose executable paths to the renderer.

## 3. Future capability groups

Availability must be marked accurately until each capability ships.

### 3.1 AI-assisted editing

Future editing assistance can:

- propose cuts, pause removal, and candidate edit points;
- identify highlights and assemble candidate sequences;
- propose reframing for chosen target aspect ratios; and
- generate, refine, or align caption suggestions.

Suggestions are non-destructive. The user decides if and how a candidate becomes local timeline state.

### 3.2 AI-assisted generation

Future generation can create optional project assets such as:

- scene or B-roll suggestions;
- narration or voice assets; and
- image assets for use in a video project.

Generated assets enter the local asset workflow only after the result is available and the user elects to import it. Provider origin and relevant generation metadata should remain inspectable without exposing secrets.

## 4. Future system design

### 4.1 Shared contracts

AI features belong behind typed shared contracts in `src/shared/`, not renderer-specific request shapes. Future work should distinguish:

- `AiOperation` — a user-requested capability such as caption suggestion or B-roll generation;
- `AiExecutionPath` — `local_model` or `connected_service`;
- `AiInputManifest` — the approved material and metadata used by an operation;
- `AiJob` — queued, running, succeeded, failed, cancelled, or requires-user-action state;
- `AiResult` — suggestions or importable local assets; and
- `AiProvider` — capability, validation, job, cancellation, and normalized-result contract.

Provider-specific identifiers remain in the main process or a dedicated backend adapter. The renderer receives typed status and safe display metadata only.

### 4.2 Process boundaries

- **Renderer:** collects user intent, shows disclosure and approval UI, renders job status, and lets users review results.
- **Preload:** exposes a narrow typed AI job bridge; never exposes raw IPC, credentials, provider clients, or filesystem paths.
- **Main process or approved backend adapter:** validates input, resolves the selected provider, performs local execution or user-approved remote requests, normalizes errors, stores safe local results, and manages cancellation.
- **Local project store:** remains authoritative for accepted timeline changes and imported results.

No connected-service request may be introduced without a focused design covering credential handling, data retention, retries, errors, cancellation, provider terms, and consent disclosure.

### 4.3 Job lifecycle

A future AI job has this minimum lifecycle:

1. User selects a local asset, timeline range, or textual request.
2. The app displays the selected operation, path, provider/model, and input manifest.
3. The user explicitly starts the job.
4. The app persists a local job record and exposes queued/running state.
5. The app displays a reviewable result, failure explanation, or cancellation result.
6. The user optionally imports assets or applies suggestions through a separate, undoable local edit.

The app must preserve recoverable local job state if it exits during an operation and must not delete original local media after an AI job starts or completes.

## 5. Data boundary

| Concern | Local model path | Connected service path |
| --- | --- | --- |
| Project and timeline | Stored locally | Stored locally unless a user explicitly submits selected material for the current operation |
| Input material | Processed on device | Disclosed before submission; only the approved manifest may be sent |
| Result | Stored or imported locally after user review | Retrieved to a local staging/import flow after user review |
| Provider visibility | Local runtime configuration only | Provider/service name and operation visible before start |
| User control | Configure, run, cancel where supported, delete local results | Select, authorize, run, cancel where supported, and delete local results |

Accounts, billing, analytics, crash reporting, cloud project sync, and hidden network activity remain out of scope. A provider integration does not itself authorize any of these features.

## 6. UX and accessibility requirements

- AI workflow navigation and status must have semantic labels and keyboard access.
- AI execution path, provider/service, and information-disclosure text must be readable text; do not communicate a remote boundary through color or an icon alone.
- Job states must be exposed through accessible status messaging.
- The edit timeline remains visually and functionally primary; AI is an assistive workspace or action, not an opaque autonomous editor.
- Errors distinguish invalid local setup, rejected consent, network/provider error, content-policy outcome, cancellation, and unavailable capability without exposing secrets.

## 7. Release and public-copy boundary

The initial July MVP described local selected-window capture, local project/timeline editing, and local MP4 export. The current release boundary is broader: the approval-gated Edit Agent and provider-backed voice, image, and video generation are shipped. See [the root README](../README.md) for provider-specific availability and platform limits.

The following capability groups remain future-facing until a separately reviewed implementation ships: AI-assisted edit suggestions (cuts, highlight sequences, reframing, captions), automated acceptance of suggestions into a saved timeline, cloud project sync, hosted rendering, accounts, analytics, and hidden network activity.

For every shipped or future capability, README, renderer, product site, app metadata, and marketing materials must state whether processing is local or provider-connected, and must not present a proposed capability as current behavior.

## 8. Implementation sequence

1. Define and test shared AI job, input-manifest, result, and provider contracts without a provider adapter.
2. Design the renderer disclosure, job status, review, acceptance, and undo flows.
3. Implement one local-model-backed capability with a user-provided configuration and explicit failure states.
4. Review a provider-specific connected-service proposal, including credentials and operation-level data disclosure, before adding a remote adapter.
5. Add one connected-service capability only after its adapter, cancellation, error, retention, and result-import behavior have focused tests.
6. Update product documentation and website copy only for the capability that has passed its release verification.

Each step requires an issue-scoped branch, focused tests that fail before the behavior is added, full typecheck/test/build verification, independent review, and the documented `dev` → `main` release path.

## 9. Non-goals

- Building any provider, model, or network integration in this design-only change.
- Replacing the local timeline with an autonomous or cloud-first workflow.
- Automatically downloading local models or runtimes.
- Automatically sending media or metadata to a remote service.
- Publishing future AI capabilities as current product behavior.
