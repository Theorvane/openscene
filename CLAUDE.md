# OpenScene Agent & Development Guidelines (Claude Entrypoint)

> **Inherits and enforces all rules in [`AGENTS.md`](./AGENTS.md).**

## Project Overview & Architecture

OpenScene is an Electron, React, TypeScript, and Vite desktop application built with local-first security and hybrid AI capabilities.

- **Main Surface** (`src/main/`): Desktop capture, project storage, FFmpeg jobs, local TTS, TypeMCP server (`src/main/openVideoMcpServer.ts`).
- **Preload Surface** (`src/preload/`): Context-isolated IPC bridge exposing typed `window.videoTool`.
- **Renderer Surface** (`src/renderer/`): React NLE timeline editor, AI Video Studio, AI Voice Studio, Theme Selector, and Settings.
- **Shared Surface** (`src/shared/`): Type contracts, IPC definitions, timeline models, LLM models catalog (`src/shared/llmModels.ts`), and provider seams.
- **Agent Skills**: `.agents/skills/api-to-typemcp/SKILL.md` for OpenAPI/Swagger to TypeMCP generator orchestration.

## Common Development Commands

```bash
npm install        # Install dependencies
npm run dev        # Run local Electron + Vite development server
npm run typecheck  # Run strict TypeScript typechecking
npm test           # Run Vitest unit & integration test suite
npm run build      # Perform typecheck and build Electron main, preload, & renderer into out/
```

## Mandatory Agent Workflow Rules (from `AGENTS.md`)

1. Inspect open GitHub Issues & PRs, then create or update one focused GitHub Issue before branching.
2. Put the issue number in the branch name: `<type>/<issue-number>-<short-description>` (e.g. `feat/24-typemcp-agent-integration`).
3. Branch from current `origin/dev`.
4. Use Conventional Commit format: `type(scope): subject`.
5. Push branch and open a PR targeting `dev` with `Closes #<issue-number>` in the body.
6. Verify code using `npm run typecheck && npm test && npm run build` before asking for review or merging.

For full architecture details, local security constraints, and public compatibility identifiers, refer directly to [`AGENTS.md`](./AGENTS.md).
