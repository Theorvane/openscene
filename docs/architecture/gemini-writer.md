# Gemini Writer architecture

## Purpose

Writer turns an idea or source article into a screenplay and shot plan, or
creates a revision of an existing screenplay. Desktop and mobile produce the
same `AiProjectDocument` graph and never persist unvalidated model output.

## Models and transport

- `gemini-3.1-pro-preview` is the quality default for long-form reasoning and
  continuity-sensitive writing.
- `gemini-3.1-flash-lite` is the economy option for quick drafts and batch
  adaptation.
- Both use Gemini `generateContent` with `application/json` structured output.
- This lane uses the official Gemini API. The desktop reads the existing API
  key only in the Electron main process; it never accepts a key from the
  renderer or puts one in an IPC payload. Mobile reads the key from the device
  keystore immediately before the explicit request.
- Stored browser-session cookies are not used by Writer. Automating the Gemini
  website is a separate, deferred adapter because its private request format is
  not a stable provider contract.

The current model identifiers and structured-output support were checked
against the Google Gemini model and structured-output documentation on
2026-09-03. Both models are part of the Gemini 3 family; model availability and
pricing remain provider-controlled and must be rechecked before a release.

## Shared contract

`src/shared/writerWorkflow.ts` is the only definition of:

- the three operations: idea to script, content to script, and rewrite;
- accepted request limits;
- the response JSON Schema and semantic validator;
- prompt compilation;
- conversion into scripts, characters, scenes, shots, and a style bible.

`src/shared/writerGeneration.ts` owns the portable Gemini HTTP call. Desktop
reaches it through a typed main-process IPC handler. Mobile calls the same seam
after retrieving its credential locally.

## Review and persistence boundary

Generation produces an in-memory preview. No script status or project field is
changed until the user selects **Save to project**.

On save, `applyWriterDraft` validates the response again and then validates the
entire candidate `AiProjectDocument`. A rewrite creates a child
`ScriptVersion`, marks only its parent as superseded, and keeps the old scenes
and shots as revision history. Existing characters are reused by normalized
name; new character, scene, and shot IDs must not collide with the project.

Desktop AI-document persistence deliberately merges the saved AI graph into
the current in-memory project so an older disk snapshot cannot overwrite
unsaved timeline edits.

## Security and failure behavior

- Source text is bracketed as untrusted material in the prompt.
- Unknown request fields, unsupported model IDs, oversized values, partial
  drafts, dangling character names, and malformed JSON fail closed.
- Provider-supported schema bounds constrain scenes, shots, list sizes, and
  each shot duration before generation. Semantic failures report only a safe
  field path and rule (for example, an undeclared character reference), never
  the generated screenplay value itself.
- Provider errors are length-bounded. API keys are only sent in the
  `x-goog-api-key` header and are never included in error text.
- A visible Generate action is required for every paid network request.
- A failed request or save leaves the current project unchanged and restores
  the UI from its busy state.

## Deferred

Grok Writer, browser-session execution, live pricing estimates, screenplay
import/export, voice generation, subtitles, and video generation are separate
issues. Writer only establishes the planning graph those later phases consume.
