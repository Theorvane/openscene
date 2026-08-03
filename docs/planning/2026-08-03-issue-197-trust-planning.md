# Issue 197: Trust & Planning Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Document OpenScene's real security/process architecture, ensure legal shot planning is exact whenever possible, and remove the current MCP production audit finding.

**Architecture:** README and historical planning documents name the renderer/preload/main/shared/local/provider boundaries. A bounded dynamic-programming planner selects the optimal legal shot sequence before the existing tool surfaces it. The direct TypeMCP version update regenerates npm's lockfile.

**Tech Stack:** TypeScript, Vitest, npm, Electron/Vite, Mermaid Markdown.

---

### Task 1: Lock the exact-first storyboard contract in tests

**Objective:** Demonstrate that the existing greedy planner unnecessarily rounds a representable request.

**Files:**
- Modify: `tests/videoStoryboardPlan.test.ts`

**Step 1: Write failing test**

Add a case for Google Gemini 10 seconds that expects `[6, 4]`, total `10`, and no `roundedFrom`.

**Step 2: Run test to verify failure**

Run: `npm test -- tests/videoStoryboardPlan.test.ts --reporter=dot`

Expected: FAIL because the current longest-first loop returns 12 seconds (`[8, 4]`).

**Step 3: Commit**

Do not commit until the implementation and tests are green as one coherent feature slice.

### Task 2: Implement bounded exact-first legal-duration planning

**Objective:** Select the optimal legal duration sequence without exceeding the 24-shot cap.

**Files:**
- Modify: `src/shared/videoStoryboardPlan.ts`
- Test: `tests/videoStoryboardPlan.test.ts`

**Step 1: Implement minimal planner**

Enumerate totals reachable by legal durations with at most `MAX_PLANNED_SHOTS`. Select an exact plan first; otherwise select the smallest absolute distance. Compare ties by fewer shots and lexicographically longer earlier durations.

**Step 2: Run focused tests**

Run: `npm test -- tests/videoStoryboardPlan.test.ts --reporter=dot`

Expected: PASS.

**Step 3: Run affected checks**

Run: `npm run typecheck && npm test -- --reporter=dot`

Expected: PASS.

### Task 3: Update TypeMCP and validate production dependency safety

**Objective:** Remove the current `@hono/node-server` moderate audit finding through a direct supported dependency upgrade.

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`

**Step 1: Upgrade**

Run: `npm install @theorvane/type-mcp@0.3.1 --save-exact`.

**Step 2: Verify resolution**

Run: `npm ls @theorvane/type-mcp @modelcontextprotocol/sdk @hono/node-server --all && npm audit --omit=dev --audit-level=moderate`

Expected: TypeMCP 0.3.1; no moderate-or-higher production audit result.

**Step 3: Run affected checks**

Run: `npm run typecheck && npm test -- --reporter=dot && npm run build`

Expected: PASS.

### Task 4: Publish architecture and capability-boundary documentation

**Objective:** Make the current implementation legible and prevent stale future-only claims.

**Files:**
- Modify: `README.md`
- Modify: `docs/planning.md`
- Modify: `docs/hybrid-ai-editor-direction.md`

**Step 1: Add README architecture section**

Add the approved Mermaid diagram after the product explanation and explain each process ownership and local/connected boundary.

**Step 2: Reconcile historical documents**

Mark the planning document's state accurately and add a current-capability pointer. Update the hybrid direction's status/release boundary to distinguish released generation/agent capabilities from still-future assisted-editing capabilities.

**Step 3: Verify source documentation contract**

Run: `npm test -- tests/openSceneBrandingSource.test.ts --reporter=dot && git diff --check`

Expected: PASS.

### Task 5: Complete cross-surface verification and delivery checkpoint

**Objective:** Prove the shared-core change and release documentation are ready for review.

**Files:**
- Review: all changed files

**Step 1: Run full verification**

Run:

```bash
npm test -- --reporter=dot
npm run typecheck
npm run build
npm --prefix mobile run typecheck
npm audit --omit=dev --audit-level=moderate
git diff --check
git status --short --branch
```

**Step 2: Commit and push**

Create one conventional commit, push `feat/197-trust-planning`, then open a PR against `dev` with `Closes #197`.
