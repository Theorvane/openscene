import { randomUUID } from 'node:crypto';

import {
  AGENT_ROUTER_BASE_URL,
  agentRouterNativeModelId,
  isAgentRouterModelId
} from '../shared/agentRouter';
import {
  WRITER_RESPONSE_JSON_SCHEMA,
  WRITER_SYSTEM_PROMPT,
  compileWriterPrompt,
  parseWriterRequest,
  validateWriterDraft,
  type WriterDraft,
  type WriterGenerationInput
} from '../shared/writerWorkflow';

const AGENT_ROUTER_WRITER_TIMEOUT_MS = 300_000;
const AGENT_ROUTER_HEARTBEAT_MS = 10_000;
const AGENT_ROUTER_WRITER_URL = `${AGENT_ROUTER_BASE_URL}/chat/completions`;

type FetchLike = typeof fetch;

export type AgentRouterHttpWriterInput = WriterGenerationInput & {
  readonly apiKey: string;
  readonly fetchImpl?: FetchLike;
};

type DiagnosticFields = Readonly<Record<string, string | number | boolean | null | undefined>>;

function terminalLog(
  runId: string,
  level: 'info' | 'warn' | 'error',
  event: string,
  fields: DiagnosticFields = {}
): void {
  const present = Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined));
  const suffix = Object.keys(present).length === 0 ? '' : ` ${JSON.stringify(present)}`;
  console[level](`[OpenScene][AgentRouter Writer][${runId}] ${event}${suffix}`);
}

function redact(value: string, apiKey: string, privateText: readonly string[]): string {
  let redacted = value.replaceAll(apiKey, '[REDACTED]');
  for (const text of privateText) {
    if (text.length > 0) redacted = redacted.replaceAll(text, '[REDACTED_INPUT]');
  }
  return redacted.trim().slice(0, 500);
}

function messageText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map((part) => {
    if (typeof part === 'string') return part;
    if (typeof part !== 'object' || part === null) return '';
    const value = part as Record<string, unknown>;
    if (typeof value.text === 'string') return value.text;
    return typeof value.content === 'string' ? value.content : '';
  }).join('');
}

function decodeWriterJson(raw: string): { readonly ok: true; readonly value: unknown } | { readonly ok: false } {
  let candidate = raw.trim();
  const fenced = candidate.match(/^```(?:json)?\s*\r?\n([\s\S]*?)\r?\n```$/i);
  if (fenced?.[1] !== undefined) candidate = fenced[1].trim();
  try {
    return { ok: true, value: JSON.parse(candidate) as unknown };
  } catch {
    return { ok: false };
  }
}

async function responseError(response: Response, apiKey: string, privateText: readonly string[]): Promise<string> {
  const raw = await response.text().catch(() => '');
  let detail = raw;
  try {
    const parsed = JSON.parse(raw) as { error?: { message?: unknown } | string; message?: unknown };
    detail = typeof parsed.error === 'string'
      ? parsed.error
      : typeof parsed.error?.message === 'string'
        ? parsed.error.message
        : typeof parsed.message === 'string' ? parsed.message : raw;
  } catch {
    // A non-JSON gateway response is still useful after redaction.
  }
  return redact(detail, apiKey, privateText);
}

/**
 * Generate through AgentRouter's OpenAI-compatible endpoint. The API key stays
 * in the Electron main process and is supplied in both header forms required
 * by AgentRouter/NewAPI-compatible deployments.
 */
export async function requestAgentRouterHttpWriter(input: AgentRouterHttpWriterInput): Promise<WriterDraft> {
  const request = parseWriterRequest(input.request);
  if (request === null) throw new Error('Writer request is invalid.');
  if (!isAgentRouterModelId(input.modelId)) throw new Error('AgentRouter Writer model is not allowed.');
  const apiKey = input.apiKey.trim();
  if (apiKey.length === 0) throw new Error('AgentRouter API key is required.');

  const runId = randomUUID().slice(0, 8);
  const startedAt = Date.now();
  const privateText = [request.sourceText, request.currentScreenplay ?? ''];
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), AGENT_ROUTER_WRITER_TIMEOUT_MS);
  const heartbeat = setInterval(() => {
    terminalLog(runId, 'info', 'request.working', {
      elapsedSeconds: Math.round((Date.now() - startedAt) / 1000),
      transport: 'openai-compatible-http'
    });
  }, AGENT_ROUTER_HEARTBEAT_MS);
  heartbeat.unref();

  terminalLog(runId, 'info', 'request.start', {
    model: agentRouterNativeModelId(input.modelId),
    mode: request.mode,
    targetSeconds: request.targetDurationSeconds,
    sourceCharacters: request.sourceText.length,
    screenplayCharacters: request.currentScreenplay?.length ?? 0,
    timeoutSeconds: Math.round(AGENT_ROUTER_WRITER_TIMEOUT_MS / 1000),
    transport: 'openai-compatible-http'
  });

  try {
    const response = await (input.fetchImpl ?? fetch)(AGENT_ROUTER_WRITER_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        apiKey,
        'User-Agent': 'OpenScene'
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: agentRouterNativeModelId(input.modelId),
        messages: [
          { role: 'system', content: WRITER_SYSTEM_PROMPT },
          {
            role: 'user',
            content: [
              compileWriterPrompt(request),
              'Return exactly one JSON object and no prose. The object must satisfy this JSON Schema:',
              JSON.stringify(WRITER_RESPONSE_JSON_SCHEMA)
            ].join('\n\n')
          }
        ],
        stream: false,
        temperature: 0.4,
        max_tokens: 32_768
      })
    });
    terminalLog(runId, response.ok ? 'info' : 'warn', 'response.received', {
      status: response.status,
      elapsedSeconds: Math.round((Date.now() - startedAt) / 1000)
    });
    if (!response.ok) {
      const detail = await responseError(response, apiKey, privateText);
      throw new Error(`AgentRouter Writer failed with status ${response.status}${detail ? `: ${detail}` : ''}.`);
    }

    const payload = await response.json() as {
      model?: unknown;
      usage?: { prompt_tokens?: unknown; completion_tokens?: unknown; total_tokens?: unknown };
      choices?: readonly { message?: { content?: unknown } }[];
    };
    const content = messageText(payload.choices?.[0]?.message?.content).trim();
    terminalLog(runId, 'info', 'response.complete', {
      model: typeof payload.model === 'string' ? payload.model : undefined,
      resultCharacters: content.length,
      promptTokens: typeof payload.usage?.prompt_tokens === 'number' ? payload.usage.prompt_tokens : undefined,
      completionTokens: typeof payload.usage?.completion_tokens === 'number' ? payload.usage.completion_tokens : undefined,
      totalTokens: typeof payload.usage?.total_tokens === 'number' ? payload.usage.total_tokens : undefined
    });
    if (content.length === 0) throw new Error('AgentRouter Writer returned an empty response.');
    const decoded = decodeWriterJson(content);
    if (!decoded.ok) throw new Error('AgentRouter Writer returned invalid JSON.');
    const validation = validateWriterDraft(decoded.value);
    if (!validation.ok) {
      throw new Error(`AgentRouter Writer returned an invalid project draft at ${validation.issue.path}: ${validation.issue.message}`);
    }
    terminalLog(runId, 'info', 'request.complete', {
      elapsedSeconds: Math.round((Date.now() - startedAt) / 1000),
      scenes: validation.value.scenes.length,
      shots: validation.value.scenes.reduce((total, scene) => total + scene.shots.length, 0)
    });
    return validation.value;
  } catch (error) {
    const timedOut = error instanceof Error && error.name === 'AbortError';
    const detail = timedOut
      ? `AgentRouter Writer did not respond within ${AGENT_ROUTER_WRITER_TIMEOUT_MS / 1000}s.`
      : redact(error instanceof Error ? error.message : String(error), apiKey, privateText);
    terminalLog(runId, 'error', 'request.failed', {
      elapsedSeconds: Math.round((Date.now() - startedAt) / 1000),
      error: detail || 'AgentRouter Writer failed.'
    });
    throw new Error(detail || 'AgentRouter Writer failed.');
  } finally {
    clearTimeout(timeout);
    clearInterval(heartbeat);
  }
}
