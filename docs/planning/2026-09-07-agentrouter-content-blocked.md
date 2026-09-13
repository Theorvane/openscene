# AgentRouter staged Writer content-block hardening

Issue: [Theorvane/openscene#332](https://github.com/Theorvane/openscene/issues/332)

## Observed failure

The final `prompts` stage failed before model output on both DeepSeek V4 Flash and GLM 5.3. Codex CLI exited normally enough to emit structured diagnostics, but AgentRouter returned `content-blocked` within four seconds. VieNeu, renderer startup, credentials, process cleanup and timeout handling were not involved.

## Correction

- Codex CLI now receives the strict response schema through its native `--output-schema` option. The schema is written only inside the per-request temporary workspace and is cleaned with that workspace.
- Concept and screenplay still receive the creator's original brief. Breakdown and production-prompt stages consume their approved upstream documents without duplicating the raw instruction-heavy brief.
- Approved screenplay remains authoritative in response validation and project application.
- A provider `content-blocked` result is converted to a short actionable message with its safe request ID. Credentials, source material and generated text remain absent from terminal logs.
- No automatic wording rewrite or moderation bypass is attempted. A persistent provider policy block still requires a creator edit or another configured Writer provider.

## Verification

- Focused AgentRouter/Writer suite: 44/44 passed across five files.
- Root TypeScript check and production Electron build passed.
- Mobile TypeScript check passed.
- Full root suite: 1,285/1,309 passed. The remaining 24 failures match the established Windows CRLF, symlink-permission, FFmpeg/source-fixture and source-assertion baseline; no AgentRouter/Writer test failed.
- The saved project's final-stage prompt was inspected locally without logging its text: the original brief is no longer present, while all three approved stage artifacts remain available.
- A live provider retry was deliberately left to the creator because generating the complete 480-second production plan consumes the configured AgentRouter account.
