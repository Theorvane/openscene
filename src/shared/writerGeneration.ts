import {
  GEMINI_WRITER_MODEL_IDS,
  WRITER_RESPONSE_JSON_SCHEMA,
  WRITER_SYSTEM_PROMPT,
  compileWriterPrompt,
  parseWriterRequest,
  validateWriterDraft,
  type WriterDraft,
  type WriterModelId,
  type WriterRequest
} from './writerWorkflow';
import {
  AGENT_ROUTER_WRITER_DESKTOP_ONLY_REASON,
  isAgentRouterModelId
} from './agentRouter';

type FetchLike = typeof fetch;

export type GeminiWriterInput = {
  readonly apiKey: string;
  readonly modelId: Extract<WriterModelId, `gemini-${string}`>;
  readonly request: WriterRequest;
  readonly fetchImpl?: FetchLike;
};

export type WriterProviderInput = {
  readonly apiKey: string;
  readonly modelId: WriterModelId;
  readonly request: WriterRequest;
  readonly fetchImpl?: FetchLike;
};

async function providerError(response: Response, secret: string): Promise<string> {
  const text = await response.text().catch(() => '');
  let detail: string;
  try {
    const parsed = JSON.parse(text) as { error?: { message?: string } };
    detail = parsed.error?.message ?? text;
  } catch {
    detail = text;
  }
  return detail.replaceAll(secret, '[REDACTED]').slice(0, 300);
}

export async function requestGeminiWriter(input: GeminiWriterInput): Promise<WriterDraft> {
  const request = parseWriterRequest(input.request);
  if (request === null) throw new Error('Writer request is invalid.');
  if (!(GEMINI_WRITER_MODEL_IDS as readonly string[]).includes(input.modelId)) throw new Error('Gemini Writer model is not allowed.');
  if (input.apiKey.trim().length === 0) throw new Error('Gemini API key is required.');
  const fetchImpl = input.fetchImpl ?? fetch;
  const response = await fetchImpl(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(input.modelId)}:generateContent`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': input.apiKey.trim() },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: WRITER_SYSTEM_PROMPT }] },
        contents: [{ role: 'user', parts: [{ text: compileWriterPrompt(request) }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          responseJsonSchema: WRITER_RESPONSE_JSON_SCHEMA
        }
      })
    }
  );
  if (!response.ok) {
    const detail = await providerError(response, input.apiKey.trim());
    throw new Error(`Gemini Writer failed with status ${response.status}${detail.length > 0 ? `: ${detail}` : ''}.`);
  }
  const payload = await response.json() as {
    candidates?: readonly { content?: { parts?: readonly { text?: string }[] } }[];
  };
  const json = payload.candidates?.[0]?.content?.parts?.map((part) => part.text ?? '').join('').trim();
  if (!json) throw new Error('Gemini Writer returned an empty response.');
  let decoded: unknown;
  try {
    decoded = JSON.parse(json);
  } catch {
    throw new Error('Gemini Writer returned invalid JSON.');
  }
  const validation = validateWriterDraft(decoded);
  if (!validation.ok) {
    throw new Error(`Gemini Writer returned an invalid project draft at ${validation.issue.path}: ${validation.issue.message}`);
  }
  return validation.value;
}

/**
 * Shared code is also used by React Native, where the AgentRouter credential
 * and HTTP path are not enabled yet. This seam fails before making a network
 * request; desktop routes the same model IDs through its main-process HTTP
 * bridge instead.
 */
export async function requestAgentRouterWriter(input: WriterProviderInput): Promise<WriterDraft> {
  const request = parseWriterRequest(input.request);
  if (request === null) throw new Error('Writer request is invalid.');
  if (!isAgentRouterModelId(input.modelId)) throw new Error('AgentRouter Writer model is not allowed.');
  if (input.apiKey.trim().length === 0) throw new Error('AgentRouter API key is required.');
  throw new Error(AGENT_ROUTER_WRITER_DESKTOP_ONLY_REASON);
}

export function requestWriter(input: WriterProviderInput): Promise<WriterDraft> {
  if (isAgentRouterModelId(input.modelId)) return requestAgentRouterWriter(input);
  if ((GEMINI_WRITER_MODEL_IDS as readonly string[]).includes(input.modelId)) {
    return requestGeminiWriter(input as GeminiWriterInput);
  }
  return Promise.reject(new Error('Writer model is not allowed.'));
}
