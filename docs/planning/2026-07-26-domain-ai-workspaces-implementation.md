# Domain AI Workspaces Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Give Voice Studio, Video Studio, and the LangGraph Edit Agent independent, capability-safe model settings; allow explicitly imported generated assets to become reviewable Edit Agent context.

**Architecture:** Add a shared AI domain catalog/preference module and renderer context with independent persisted non-secret choices. Thread typed voice/video selections into existing IPC job requests and preserve existing result-import behavior. Extend the existing LangGraph Agent Chat context with user-attached project asset references and render an OpenCode-style Edit Agent panel alongside the timeline; all MCP writes remain LangGraph approval-gated.

**Tech Stack:** Electron, React, TypeScript, Vitest, LangGraph, LangChain, TypeMCP, safeStorage-backed credentials.

---

## Acceptance cases

| Case | Expected result |
| --- | --- |
| A1 | Voice, Video, Edit Agent selections persist independently and stale/unavailable IDs fall back to an available model for that domain. |
| A2 | Voice UI cannot select a video/agent model; Video UI cannot select a voice/agent model; unavailable cloud entries communicate why. |
| A3 | Typed generation requests include only safe `providerId` / `modelId` fields; main process rejects invalid domain/model pairs before a job starts. |
| A4 | A completed generated result is imported into the active project before it can be attached to the edit agent. |
| A5 | An attached asset includes safe project metadata only; never an output path, API key, or arbitrary file path. |
| A6 | The Edit Agent presents model settings, project/asset context, transcript/tool history, and the existing approval queue without replacing direct timeline editing. |
| A7 | Project writes remain in `AGENT_CHAT_MUTATING_TOOL_NAMES`; deny/error/rejected IPC preserve project state and release the UI lock. |

## Task 1: Shared domain catalog and preference parsing

**Objective:** Introduce capability-specific model catalogs and safe domain preference normalization.

**Files:**
- Create: `src/shared/aiDomainModels.ts`
- Create: `tests/aiDomainModels.test.ts`

**Step 1: Write failing tests**

Test exact catalog facts and parser behavior:

```ts
expect(getAvailableDomainModels('voice-generation').map((m) => m.id)).toEqual(['local-qwen-tts']);
expect(parseDomainModelPreferences({ 'voice-generation': 'gemini-veo' })['voice-generation'].modelId)
  .toBe('local-qwen-tts');
expect(getDomainModel('edit-agent', 'local-video-runner')).toBeUndefined();
```

**Step 2: Run RED**

Run: `npm test -- --run tests/aiDomainModels.test.ts`

Expected: FAIL because `aiDomainModels` does not exist.

**Step 3: Implement minimal catalog contract**

Export:

```ts
export type AiDomain = 'voice-generation' | 'video-generation' | 'edit-agent';
export type AiDomainModelConfig = {
  id: string; providerId: string; label: string; executionPath: 'local' | 'api';
  domains: readonly AiDomain[]; available: boolean; unavailableReason?: string;
};
export type AiDomainModelPreferences = Record<AiDomain, string>;
```

Represent only currently usable local entries as available: Local Qwen TTS, Local Video Runner, Qwen 2.5 Coder/Ollama tool calling. Include declared cloud options disabled with accurate adapter-unavailable reasons.

**Step 4: Run GREEN**

Run: `npm test -- --run tests/aiDomainModels.test.ts`

Expected: PASS.

**Step 5: Commit**

```bash
git add src/shared/aiDomainModels.ts tests/aiDomainModels.test.ts
git commit -m "feat(ai): define domain model catalogs"
```

## Task 2: Independent renderer preference provider

**Objective:** Persist non-secret domain selections independently without changing credential storage.

**Files:**
- Create: `src/renderer/src/AiDomainModelContext.tsx`
- Modify: `src/renderer/src/AppShell.tsx`
- Test: `tests/aiDomainModels.test.ts`

**Step 1: Write failing parser/contract tests**

Add tests for `AI_DOMAIN_MODEL_STORAGE_KEY`, default selection per domain, and stale persisted values falling back to a domain-valid available model.

**Step 2: Run RED**

Run: `npm test -- --run tests/aiDomainModels.test.ts`

Expected: FAIL due to missing storage key/provider behavior.

**Step 3: Implement context**

Create a provider exposing:

```ts
selectedModelId(domain: AiDomain): string;
selectedModel(domain: AiDomain): AiDomainModelConfig;
setSelectedModelId(domain: AiDomain, modelId: string): void;
```

Store only normalized model IDs in `openvideo-ai-domain-model-preferences-v1`. Wrap `AppShell` contents so the persistent agent and all workspaces share the same domain preferences.

**Step 4: Run GREEN**

Run: `npm test -- --run tests/aiDomainModels.test.ts && npm run typecheck`

Expected: PASS.

**Step 5: Commit**

```bash
git add src/renderer/src/AiDomainModelContext.tsx src/renderer/src/AppShell.tsx tests/aiDomainModels.test.ts
git commit -m "feat(ai): persist model choices per domain"
```

## Task 3: Reusable accessible domain selector

**Objective:** Render filtered model choices and accessible unavailable reasons consistently.

**Files:**
- Create: `src/renderer/src/AiDomainModelSelector.tsx`
- Create: `tests/aiDomainModelSelectorSource.test.ts`

**Step 1: Write failing source/accessibility contract test**

Assert a domain label, selected `<select>`, disabled unavailable options, and visible unavailable reason are rendered from `getDomainModels(domain)` rather than global LLM models.

**Step 2: Run RED**

Run: `npm test -- --run tests/aiDomainModelSelectorSource.test.ts`

Expected: FAIL because component is missing.

**Step 3: Implement minimal component**

Component props: `domain`, `label`, optional `description`. It reads the domain context, renders available selection, disabled unavailable choices, and a `role="status"` safe readiness description. It must not receive or display credentials.

**Step 4: Run GREEN**

Run: `npm test -- --run tests/aiDomainModelSelectorSource.test.ts && npm run typecheck`

Expected: PASS.

**Step 5: Commit**

```bash
git add src/renderer/src/AiDomainModelSelector.tsx tests/aiDomainModelSelectorSource.test.ts
git commit -m "feat(ai): add capability-safe model selector"
```

## Task 4: Typed generation request validation

**Objective:** Carry safe generation model IDs into IPC and reject incompatible selections in main process.

**Files:**
- Modify: `src/shared/providerSeams.ts`
- Modify: `src/main/aiJobManager.ts`
- Modify: `src/main/index.ts`
- Modify: `src/preload/index.ts`
- Test: `tests/aiJobManager.test.ts`
- Test: `tests/voiceTtsContracts.test.ts`

**Step 1: Write failing tests**

Add a local video request with `{ provider: 'local_video', modelId: 'local-video-runner' }` that starts successfully using the configured test runner. Add invalid/cross-domain model IDs that fail before output creation. Mirror for local speech `{ provider: 'local_qwen', modelId: 'local-qwen-tts' }`.

**Step 2: Run RED**

Run: `npm test -- --run tests/aiJobManager.test.ts tests/voiceTtsContracts.test.ts`

Expected: FAIL because requests have no validated model identity.

**Step 3: Implement minimal contracts**

Add safe model IDs to `VideoGenerationRequest`, `TextToSpeechRequest`, and job metadata. Validate them against the appropriate shared domain catalog before creating a job. Preserve current local-runner behavior and refuse cloud paths with existing truthful errors.

Replace `unknown` preload generation request types with shared request types.

**Step 4: Run GREEN**

Run: `npm test -- --run tests/aiJobManager.test.ts tests/voiceTtsContracts.test.ts && npm run typecheck`

Expected: PASS.

**Step 5: Commit**

```bash
git add src/shared/providerSeams.ts src/main/aiJobManager.ts src/main/index.ts src/preload/index.ts tests/aiJobManager.test.ts tests/voiceTtsContracts.test.ts
git commit -m "feat(ai): validate model selections for generation jobs"
```

## Task 5: Connect Voice and Video Studio to their domains

**Objective:** Replace global LLM selector usage with domain-specific model selection and carry the selection to job requests.

**Files:**
- Modify: `src/renderer/src/NarrationPanel.tsx`
- Modify: `src/renderer/src/VideoGenerationWorkspace.tsx`
- Test: `tests/domainStudioSource.test.ts`

**Step 1: Write failing source contracts**

Assert Voice Studio uses `AiDomainModelSelector domain="voice-generation"`, Video Studio uses `domain="video-generation"`, generation calls include selected safe `modelId/provider`, and no longer render `LlmModelSelectorBar`.

**Step 2: Run RED**

Run: `npm test -- --run tests/domainStudioSource.test.ts`

Expected: FAIL because studios still use the global selector or omit model IDs.

**Step 3: Implement minimal wiring**

Use `useAiDomainModel` and `AiDomainModelSelector` in Voice Studio and Video Studio. Preserve all existing profile consent, import, polling, status, and cleanup behavior. Do not expose API keys in component state for unavailable providers.

**Step 4: Run GREEN**

Run: `npm test -- --run tests/domainStudioSource.test.ts && npm run typecheck`

Expected: PASS.

**Step 5: Commit**

```bash
git add src/renderer/src/NarrationPanel.tsx src/renderer/src/VideoGenerationWorkspace.tsx tests/domainStudioSource.test.ts
git commit -m "feat(ai): use domain models in generation studios"
```

## Task 6: Explicit imported-asset handoff context

**Objective:** Allow the user to attach imported project assets to agent context without exposing result paths.

**Files:**
- Create: `src/shared/editAgentContext.ts`
- Modify: `src/renderer/src/AgentChatContext.tsx`
- Modify: `src/renderer/src/ProjectResultImportContext.tsx`
- Modify: `src/renderer/src/editor/useProjectAssetImports.ts`
- Modify: `src/renderer/src/NarrationPanel.tsx`
- Modify: `src/renderer/src/VideoGenerationWorkspace.tsx`
- Test: `tests/editAgentContext.test.ts`

**Step 1: Write failing tests**

Test context attachment accepts `{ projectId, assetId, label, mediaKind, durationMs? }`, deduplicates `(projectId, assetId)`, rejects blank IDs, and has no `filePath`, `apiKey`, or arbitrary path field.

**Step 2: Run RED**

Run: `npm test -- --run tests/editAgentContext.test.ts`

Expected: FAIL because edit-agent context contract does not exist.

**Step 3: Implement minimal handoff**

Extend project import status with the imported safe assets. After explicit import, show **Send to Edit Agent** for each resulting asset. Agent context stores only the typed safe reference. Never auto-attach an asset merely because it was generated.

**Step 4: Run GREEN**

Run: `npm test -- --run tests/editAgentContext.test.ts && npm run typecheck`

Expected: PASS.

**Step 5: Commit**

```bash
git add src/shared/editAgentContext.ts src/renderer/src/AgentChatContext.tsx src/renderer/src/ProjectResultImportContext.tsx src/renderer/src/editor/useProjectAssetImports.ts src/renderer/src/NarrationPanel.tsx src/renderer/src/VideoGenerationWorkspace.tsx tests/editAgentContext.test.ts
git commit -m "feat(agent): attach imported assets as edit context"
```

## Task 7: OpenCode-style Edit Agent workspace

**Objective:** Give the editor a dedicated agent workspace while retaining the persistent agent panel and direct timeline.

**Files:**
- Create: `src/renderer/src/EditAgentWorkspace.tsx`
- Modify: `src/renderer/src/editor/TimelineEditor.tsx`
- Modify: `src/renderer/src/AgentChatContext.tsx`
- Modify: `src/renderer/src/AgentChatPanel.tsx`
- Modify: `src/renderer/src/styles.css`
- Test: `tests/editAgentWorkspaceSource.test.ts`

**Step 1: Write failing source/accessibility tests**

Assert the editor renders `EditAgentWorkspace`, it selects `edit-agent` models only, renders attached project asset references with remove controls, reuses transcript/pending approval state, includes semantic region labels, and does not contain shell/filesystem execution affordances.

**Step 2: Run RED**

Run: `npm test -- --run tests/editAgentWorkspaceSource.test.ts`

Expected: FAIL because workspace is missing.

**Step 3: Implement minimal workspace**

Render four regions from the spec: model/connection, context attachments, conversation/tool stream, and approval queue. Reuse existing `AgentChatContext` methods so execution semantics, busy locking, and error recovery are unchanged. Persistent side panel stays as compact universal chat; the new workspace is detailed when the editor is active.

**Step 4: Run GREEN**

Run: `npm test -- --run tests/editAgentWorkspaceSource.test.ts tests/persistentAgentControlSource.test.ts && npm run typecheck`

Expected: PASS.

**Step 5: Commit**

```bash
git add src/renderer/src/EditAgentWorkspace.tsx src/renderer/src/editor/TimelineEditor.tsx src/renderer/src/AgentChatContext.tsx src/renderer/src/AgentChatPanel.tsx src/renderer/src/styles.css tests/editAgentWorkspaceSource.test.ts
git commit -m "feat(agent): add OpenCode-style edit workspace"
```

## Task 8: Context-aware LangGraph planning and safe tools

**Objective:** Pass safe selected model/context data into LangGraph and add read-only timeline inspection before later mutation expansion.

**Files:**
- Modify: `src/shared/agentChat.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/main/agentChatIpcHandlers.ts`
- Modify: `src/main/agentChatSession.ts`
- Modify: `src/main/agentChatGraph.ts`
- Modify: `src/main/agentChatModel.ts`
- Modify: `src/main/openVideoMcpServer.ts`
- Modify: `src/main/agentChatTools.ts`
- Test: `tests/agentChatGraph.test.ts`
- Test: `tests/openVideoMcpServer.test.ts`

**Step 1: Write failing tests**

Test that an attached asset context reaches agent system context as safe IDs/metadata; a `getProjectTimeline` tool is read-only and executes without approval; write tool names remain approval-gated. Test an invalid agent model is rejected by the main process before model invocation.

**Step 2: Run RED**

Run: `npm test -- --run tests/agentChatGraph.test.ts tests/openVideoMcpServer.test.ts`

Expected: FAIL because context payload/tool/model validation is missing.

**Step 3: Implement minimal graph/tool changes**

Add typed safe `contextAssets` to `AgentChatSendInput`. Build the system message dynamically from active project/context assets. Add read-only project/timeline inspection tool. Retain the current interruption policy for all writes; do not add arbitrary shell or file tools.

**Step 4: Run GREEN**

Run: `npm test -- --run tests/agentChatGraph.test.ts tests/openVideoMcpServer.test.ts tests/agentChatIpcHandlers.test.ts && npm run typecheck`

Expected: PASS.

**Step 5: Commit**

```bash
git add src/shared/agentChat.ts src/preload/index.ts src/main/agentChatIpcHandlers.ts src/main/agentChatSession.ts src/main/agentChatGraph.ts src/main/agentChatModel.ts src/main/openVideoMcpServer.ts src/main/agentChatTools.ts tests/agentChatGraph.test.ts tests/openVideoMcpServer.test.ts
git commit -m "feat(agent): provide safe project context to LangGraph"
```

## Task 9: Full verification, review, and PR

**Objective:** Verify the integrated feature, update issue/PR evidence, and request independent review.

**Files:**
- Modify only if verification exposes a defect.

**Step 1: Run full suite**

```bash
npm test
npm run typecheck
npm run build
git diff --check
```

Expected: all pass.

**Step 2: Independent review**

Review for: cross-domain model validation, safe credential/path boundary, asset attachment consent, LangGraph approval completeness, busy-lock recovery, and accessibility.

**Step 3: Push and open PR**

```bash
git push -u origin feat/44-domain-ai-workspaces
gh pr create --repo Theorvane/openvideo --base dev --head feat/44-domain-ai-workspaces \
  --title "feat(ai): split models across generation and editing" \
  --body-file /tmp/openvideo-pr-44-body.md
```

PR body must include `Closes #44`, exact test/build output, capability limits, and no false cloud-provider claims.

**Step 4: Wait for CI**

Run: `gh pr checks <number> --repo Theorvane/openvideo --watch`

Expected: `verify` passes before requesting merge.
