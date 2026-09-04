# Versioned media capability registry

**Status:** Implemented by Issue #6

**Registry schema:** v1

**Capability snapshot:** 2026-09-02

## Decision

OpenScene keeps one shared model-level registry in `src/shared/mediaCapabilityRegistry.ts`. It replaces provider-level duration tables and UI booleans that could not represent differences between Veo versions or distinguish provider support from an adapter that is actually shipped.

```text
official provider capability
          |
          v
VideoModelCapabilities v1
  - documented operations and constraints
  - implemented operations in this build
  - adapter / credential / persisted seam binding
          |
          +--> desktop controls
          +--> mobile controls and continuity
          +--> storyboard shot lengths
          +--> job validation --> spend reservation --> adapter
```

## Provider support versus implementation

An operation can be documented but disabled. For example, Veo 3.1 documents reference images, first/last-frame interpolation, and extension, while this build currently sends only text-to-video and one starting image. Grok Imagine is recorded so later adapters use the same contract, but every xAI operation remains unavailable until a separately reviewed adapter exists.

This distinction prevents the UI from offering a control that the adapter silently drops. Unsupported duration, aspect ratio, reference count, or request path fails before credential lookup, spending reservation, and provider execution.

## Current generated controls

- Desktop video duration, aspect ratio, and image-input availability come from the selected model and operation.
- Mobile storyboard duration and continuity eligibility use the same model record.
- Planning accepts a legacy provider ID for compatibility, but current desktop/mobile/MCP callers pass the exact model ID.
- Adapters validate again at their shared network boundary. They no longer coerce square output to landscape or snap an illegal duration after the user approved a different job.

## Sources and update policy

Google entries are based on the official [Gemini video generation guide](https://ai.google.dev/gemini-api/docs/video) and [Gemini model catalog](https://ai.google.dev/gemini-api/docs/models). xAI entries are based on its official [video generation](https://docs.x.ai/developers/model-capabilities/video/generation), [editing](https://docs.x.ai/developers/model-capabilities/video/editing), and [extension](https://docs.x.ai/developers/model-capabilities/video/extension) guides.

Capability records carry a date and source URLs because preview models and constraints change. Updating a model requires contract tests and a new recorded snapshot date; business/UI code must not add an independent capability literal.

## Deferred

- xAI API and Grok browser adapters;
- Veo/Grok reference-to-video, Start-End, edit, and extend execution;
- ComfyUI motion control;
- provider discovery over live APIs;
- Writer/content model registry and structured-output prompts.
