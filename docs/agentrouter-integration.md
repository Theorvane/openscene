# AgentRouter integration

AgentRouter enforces a supported-client gate. A valid token sent by a generic
`fetch`, OpenAI SDK, or LangChain client can receive `401 unauthorized client
detected`, while Codex CLI, Claude Code, and Kilo Code are accepted. OpenScene
desktop therefore runs Writer through Codex CLI instead of calling the model
endpoint itself.

Primary references:

- [AgentRouter Codex setup](https://github.com/agentrouter-org/docs/blob/main/en/codex.md)
- [AgentRouter Claude Code setup](https://agentrouter.org/docs/claude-code.html)
- [OpenAI Codex CLI non-interactive mode](https://developers.openai.com/codex/cli/reference/#codex-exec)
- [Codex custom-provider configuration](https://developers.openai.com/codex/config-reference/)

## Supported surfaces

- **Desktop Writer:** supported through an installed Codex CLI executable. All
  five AgentRouter account aliases are passed as native model IDs; actual pool
  availability remains account-dependent.
- **Mobile Writer:** visible but disabled because React Native cannot launch the
  desktop Codex client.
- **Edit Agent:** visible but disabled for AgentRouter until its client route
  can preserve OpenScene's LangGraph tool-approval boundary. Other providers
  and local Ollama remain available.

## Codex transport

AgentRouter's current guide still shows `wire_api = "chat"`, but Codex CLI
0.153.2 only accepts the Responses wire API. OpenScene supplies the equivalent
provider configuration per invocation:

```toml
model_provider = "agentrouter"

[model_providers.agentrouter]
name = "AgentRouter"
base_url = "https://agentrouter.org/v1"
env_key = "AGENT_ROUTER_TOKEN"
wire_api = "responses"
request_max_retries = 0
stream_max_retries = 0
stream_idle_timeout_ms = 300000
```

A connectivity probe with an intentionally invalid token reached both the
AgentRouter `/v1/models` and `/v1/responses` endpoints and received an invalid
token response, rather than the unsupported-client response returned to raw
HTTP. This confirms that AgentRouter recognizes the Codex client path.

## Security and lifecycle boundary

- Desktop stores `agentRouterApiKey` in Electron `safeStorage`; renderer code
  receives only a connected/not-connected boolean.
- The key is read only in the main process and exists only in the child
  process environment as `AGENT_ROUTER_TOKEN` and `OPENAI_API_KEY`. It is never
  placed in CLI arguments, prompt text, URLs, project files, or logs.
- Every run uses `--ignore-user-config`, `--ignore-rules`, `--ephemeral`, an
  empty temporary working directory, read-only sandboxing, and approval policy
  `never`. It does not alter the user's Codex configuration or retain a Codex
  session.
- The prompt explicitly forbids tools, browsing, file inspection, and command
  execution. The temporary workspace contains only the final-result file.
- HTTP request and stream reconnection retries are both disabled to prevent
  accidental duplicate paid generations.
- Codex's stream idle limit is five minutes and OpenScene's outer deadline is
  six minutes. Terminal heartbeats continue every ten seconds.
- Windows cleanup retries transient locks. An `EBUSY` or `EPERM` cleanup error
  is logged but never replaces a valid draft or the real provider error.

## Writer contract

The model receives the same system prompt, production brief, and JSON Schema
as Gemini Writer. Codex writes only its final message to a temporary result
file. OpenScene parses and validates the object against the full `WriterDraft`
contract before returning it to the renderer.

The shared schema declares every required shot field, including `framing` and
`cameraMotion`. A response cannot alter a project until validation succeeds,
the user reviews it, and the user explicitly saves it.

## Terminal diagnostics

When OpenScene is started with `npm run dev`, each request prints redacted phase
logs under one short run ID:

```text
[OpenScene][AgentRouter Writer][12ab34cd] request.start {"transport":"codex-cli-responses",...}
[OpenScene][AgentRouter Writer][12ab34cd] client.resolved {"executable":"codex.exe"}
[OpenScene][AgentRouter Writer][12ab34cd] process.started {"pid":1234}
[OpenScene][AgentRouter Writer][12ab34cd] codex.event {"type":"thread.started"}
[OpenScene][AgentRouter Writer][12ab34cd] process.working {"elapsedSeconds":10,...}
[OpenScene][AgentRouter Writer][12ab34cd] codex.event {"type":"item.completed","itemType":"agent_message"}
[OpenScene][AgentRouter Writer][12ab34cd] process.closed {"exitCode":0,...}
[OpenScene][AgentRouter Writer][12ab34cd] response.complete {"resultCharacters":24560}
[OpenScene][AgentRouter Writer][12ab34cd] request.complete {"scenes":8,"shots":43,...}
[OpenScene][AgentRouter Writer][12ab34cd] cleanup.complete
```

Only event types, byte counts, durations, result length, validation counts, and
process status are logged. API keys, prompts, source text, and generated content
are redacted or never logged. Copy every line with the same run ID when
reporting a failure.

## Runtime dependency

Install Codex CLI with:

```powershell
npm install -g @openai/codex
```

The tested local version is `codex-cli 0.153.2`. `CODEX_CLI_EXECUTABLE` may
point to a native `codex.exe` when automatic discovery is not suitable. Claude
Code was updated to 2.1.260 during diagnosis but is no longer used by Writer.
