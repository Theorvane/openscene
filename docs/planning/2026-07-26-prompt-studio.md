# Prompt-first Studio Implementation Plan

> **For Hermes:** Execute this plan with test-first changes on issue #40.

**Goal:** Add a prompt-first OpenVideo workspace that uses the existing local video-generation IPC flow while preserving every existing editor workspace.

**Architecture:** Add `prompt-studio` to the shared renderer workspace model as the first/default workspace. `PromptStudioWorkspace` owns only prompt composition and job lifecycle UI; it calls the same typed preload APIs used by `VideoGenerationWorkspace` and delegates completed-result import through the existing `ProjectResultImportContext`. Remove the legacy `LlmAssistantCopilot` from app chrome only; the independent AgentChat surface remains untouched.

**Constraints:** No provider network work, no new IPC channel, no changes to timeline-editor behavior, and no change to the existing Video Generation workspace.

## Acceptance cases

| Case | Expected behavior |
| --- | --- |
| A: launch | `Prompt Studio` is first in navigation and selected by default. |
| A: generation | A non-empty prompt submits `aiGenerateVideo`; running jobs poll `aiGetVideoJob`; completed jobs expose existing project import. |
| E: empty prompt | No generation call is issued; the user receives a validation status. |
| E: failed start/poll | The UI displays a safe failure status and clears the busy state. |
| X: existing workspaces | Edit Timeline, AI Video Studio, AI Voice Studio, and Settings preserve their current IDs and relative behavior. |
| X: app chrome | `LlmAssistantCopilot` is neither imported nor rendered; AgentChat remains available. |

## Tasks

1. Update `tests/appWorkspaces.test.ts` first to require `prompt-studio` as the first/default workspace and verify navigation order.
2. Run the focused test and confirm the expected failure.
3. Update `src/renderer/src/appWorkspaces.ts` and `AppWorkspaceNavigation.tsx` with the new first workspace and icon.
4. Add `tests/promptStudioSource.test.ts` first to pin the real generation API and completed-result import contract.
5. Run the focused test and confirm the expected failure.
6. Add `src/renderer/src/PromptStudioWorkspace.tsx`, then mount it in `App.tsx` without modifying the existing Video Generation workspace.
7. Add an AppShell source-level test that asserts the legacy copilot is absent; run it red, then remove the import/render from `AppShell.tsx`.
8. Run targeted tests, typecheck, full tests, and build. Review the diff before committing.
