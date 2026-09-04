# Versioned AI project domain

**Status:** Foundation implemented by Issue #4
**Project schema:** v4
**AI document schema:** v1

## Decision

Script, storyboard and generation lineage live in the same `project.json` snapshot as assets and the authoritative timeline. The application does not create a second manifest whose copies can drift.

```text
LocalProjectSnapshot v4
  ├─ assets
  ├─ timeline v3
  └─ ai v1
      ├─ scripts → scenes → shots → generations
      ├─ characters ─────────┐
      ├─ referenceAssets ────┼→ project assets
      ├─ styleBible          │
      └─ provenance ─────────┘
```

The timeline remains the renderable edit decision. The AI document records planning, candidates and lineage; adding a generation record does not silently place its output on the timeline.

## Integrity rules

- IDs are opaque, bounded and unique within each entity collection.
- Script revision parents must exist and cannot form a cycle.
- Scene order is unique per script; shot order is unique per scene.
- Every scene references an existing script and lists exactly its shots.
- Every shot references an existing scene and lists exactly its generation records.
- Character and shot reference IDs must resolve to `ReferenceAsset` records.
- Reference assets, generation outputs and provenance asset IDs must resolve to assets in the same project snapshot.
- Generation provenance must resolve when present.
- Unknown fields, invalid enums, unbounded collections and malformed timestamps fail closed.

Top-level collections are canonicalized before persistence so equivalent documents produce stable project diffs.

## Migration

- Project v1 and v2 continue through their existing timeline migrations.
- Project v3 keeps its timeline/assets and receives `createEmptyAiProjectDocument()`.
- Project v4 requires a valid `ai` document; a missing or malformed document is not silently defaulted.
- The next successful project mutation publishes the canonical v4 snapshot through the existing atomic temporary-file-and-rename path.

## Process and platform boundary

- Shared types and validators live in `src/shared/aiProjectDomain.ts` and contain no Node/Electron dependency.
- Desktop main validates against the current project assets before saving.
- Preload exposes one typed `saveAiProjectDocument` action; no path or provider secret is accepted.
- Mobile imports the same parser/default and persists the same AI document in its local project file.
- Removing a mobile asset uses the shared detach rule to prune its character/shot references, generation outputs and provenance asset links before writing the snapshot.

This issue intentionally does not add Writer UI, Gemini prompts, provider execution or storyboard rendering. Those surfaces consume this contract in later focused issues.
