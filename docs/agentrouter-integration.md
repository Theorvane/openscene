# AgentRouter integration

OpenScene desktop connects to AgentRouter's OpenAI-compatible endpoint at
`https://agentrouter.org/v1/chat/completions`. This matches the working
integration in the user's `ptmt_qlks` project and the NewAPI chat-completion
contract.

Primary references:

- [NewAPI chat completion contract](https://docs.newapi.ai/en/docs/api/ai-model/chat/openai/createchatcompletion)
- [AgentRouter Claude Code setup](https://agentrouter.org/docs/claude-code.html)
- [AgentRouter docs source](https://github.com/agentrouter-org/docs/blob/main/vi/start.md)

## Supported surfaces

- **Desktop Writer:** supported directly through AgentRouter's
  OpenAI-compatible HTTP API. All five account aliases are sent as native model
  IDs; actual pool availability remains account-dependent.
- **Mobile Writer:** visible but disabled until the mobile credential and
  networking path receives the same hardening and diagnostics.
- **Edit Agent:** visible but disabled for AgentRouter until its HTTP route is
  integrated without bypassing OpenScene's LangGraph tool-approval boundary.
  Other providers and local Ollama remain available.

## Security and request boundary

- Desktop stores `agentRouterApiKey` in Electron `safeStorage`; renderer code
  receives only a connected/not-connected boolean.
- The key is read only in the main process and sent in the HTTPS request using
  both `Authorization: Bearer` and AgentRouter's `apiKey` compatibility header.
  It is never placed in prompt text, URLs, project files, or logs.
- The request uses `stream: false`, performs no automatic retry, and has a
  five-minute deadline. It allows up to 32,768 completion tokens for detailed
  long-form storyboards. Avoiding the Claude Code compatibility layer prevents
  duplicated multi-megabyte stream events and stuck child processes.
- Models return one JSON object using the Writer schema in the prompt.
  OpenScene parses and validates it locally before showing a draft.
- The Writer JSON Schema declares every required shot field, including
  `framing` and `cameraMotion`.
- Mobile keeps the credential slot for compatibility but does not send an
  AgentRouter request.

## Terminal diagnostics

When OpenScene is started with `npm run dev`, each desktop AgentRouter Writer
request prints redacted phase logs under one short run ID:

```text
[OpenScene][AgentRouter Writer][12ab34cd] request.start {"transport":"openai-compatible-http",...}
[OpenScene][AgentRouter Writer][12ab34cd] request.working {"elapsedSeconds":10,...}
[OpenScene][AgentRouter Writer][12ab34cd] response.received {"status":200,...}
[OpenScene][AgentRouter Writer][12ab34cd] response.complete {"resultCharacters":24560,...}
[OpenScene][AgentRouter Writer][12ab34cd] request.complete {"scenes":8,"shots":43,...}
```

The terminal receives model ID, request mode, input character counts, elapsed
time, HTTP status, safe usage totals, result length, and validation outcome. It
never prints API keys, source text, prior screenplay, or generated screenplay
content. Copy every line carrying the same run ID when reporting a failure.

## Model aliases

The built-in aliases mirror the user's AgentRouter account:

- `claude-opus-4-8`
- `claude-opus-5`
- `deepseek-v4-flash`
- `glm-5.3`
- `gpt-5.6-sol`

They use canonical OpenScene IDs such as `agentrouter/gpt-5.6-sol`; only the
native part is sent in the upstream `model` field.

## Writer contract

AgentRouter receives the same system prompt, production brief, and JSON Schema
as the Gemini Writer. OpenScene validates the returned object against the full
`WriterDraft` contract. A response cannot alter a project until validation
succeeds, the user reviews it, and the user explicitly saves it.

Claude Code is no longer a runtime dependency for AgentRouter Writer. The local
installation was nevertheless updated to `2.1.260` while diagnosing the old
`2.1.185` stream behavior.
