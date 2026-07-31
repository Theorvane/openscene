# Contributing to OpenScene

Thanks for improving OpenScene. This is a local-first Electron desktop app: keep project media, recordings, exports, voice samples, and processing on the user's device unless a proposal explicitly changes that boundary.

## Before You Start

- Search existing issues and pull requests before opening a new one.
- Use a **bug report** for reproducible defects and a **feature request** to discuss new ideas before investing in a large change.
- Do not include credentials, private media, private file paths, security exploit details, or other sensitive material in public issues or pull requests. See [SECURITY.md](SECURITY.md).

## Development Workflow

1. Create or find a GitHub issue that describes the change.
2. Update your local `dev` branch, then create a focused, issue-numbered branch from it. Use `<type>/<issue-number>-<short-description>`:
   ```bash
   git switch dev
   git pull --ff-only origin dev
   git switch -c feat/123-short-description
   ```
3. Make small, focused commits using [Conventional Commits](https://www.conventionalcommits.org/), for example `feat: add local export preset`, `fix: reject invalid media path`, or `docs: clarify FFmpeg setup`.
4. Add or update tests for behavior changes. Run the relevant focused test first, then run the full checks:
   ```bash
   npm ci
   npm run typecheck
   npm test
   npm run build
   ```
   FFmpeg-backed tests require a local `ffmpeg` executable on `PATH` or `VIDEO_TOOL_FFMPEG_PATH`; do not skip or weaken media tests.
5. Push the branch and open a pull request **to `dev`**. Complete the pull request template, link the issue, and describe validation performed.

Releases are prepared separately through reviewed pull requests from **`dev` to `main`**. Do not target feature work directly at `main`.

## Code and Security Expectations

Read [AGENTS.md](AGENTS.md) before changing application code. Preserve the Electron main/preload/renderer boundary, typed IPC contracts, and local-first behavior. Never expose raw Electron or Node APIs to the renderer, add telemetry or network calls incidentally, or commit generated media, secrets, or user data.

## Review Expectations

A pull request should have one clear purpose, include tests or a rationale when tests are not applicable, keep documentation accurate, and leave the full verification suite passing. Reviewers may request a narrower scope or a follow-up issue for unrelated work.

## Conduct

By participating, you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).
