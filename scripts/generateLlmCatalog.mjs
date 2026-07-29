#!/usr/bin/env node
/**
 * Compile the models.dev catalog (the same source opencode uses) into the
 * compact generated provider/model catalog at src/shared/llmCatalog.generated.ts.
 *
 * Usage:
 *   node scripts/generateLlmCatalog.mjs            # fetches https://models.dev/api.json
 *   node scripts/generateLlmCatalog.mjs api.json   # uses a local snapshot
 *
 * Inclusion rules (honest-adapter policy): a provider is included only when the
 * app can actually drive it —
 *   - `@ai-sdk/openai-compatible` providers with a public `api` base URL
 *   - providers with a known OpenAI-compatible endpoint (openai, groq, xai, …)
 *   - the native Anthropic and Google Gemini adapters
 * Providers that need special auth (Azure, Bedrock, Vertex, OAuth gateways)
 * are excluded rather than listed as fake options.
 */
import { writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const OUTPUT = resolve(process.cwd(), 'src/shared/llmCatalog.generated.ts');

// Legacy OpenVideo provider ids / credential slots that must stay stable.
const ID_OVERRIDES = { google: 'google_gemini' };
const CREDENTIAL_OVERRIDES = {
  openai: 'openaiApiKey',
  anthropic: 'anthropicApiKey',
  google_gemini: 'geminiApiKey',
  deepseek: 'deepseekApiKey'
};

// Known OpenAI-compatible endpoints for providers that ship a dedicated SDK.
const OPENAI_COMPATIBLE_ENDPOINTS = {
  openai: 'https://api.openai.com/v1',
  openrouter: 'https://openrouter.ai/api/v1',
  groq: 'https://api.groq.com/openai/v1',
  xai: 'https://api.x.ai/v1',
  mistral: 'https://api.mistral.ai/v1',
  togetherai: 'https://api.together.xyz/v1',
  cerebras: 'https://api.cerebras.ai/v1',
  perplexity: 'https://api.perplexity.ai',
  deepinfra: 'https://api.deepinfra.com/v1/openai'
};

const POPULAR_ORDER = ['anthropic', 'openai', 'google_gemini', 'openrouter', 'deepseek', 'groq', 'xai', 'mistral'];

function adapterFor(provider) {
  if (provider.id === 'anthropic') return { adapter: 'anthropic' };
  if (provider.id === 'google') return { adapter: 'gemini' };
  if (OPENAI_COMPATIBLE_ENDPOINTS[provider.id] !== undefined) {
    return { adapter: 'openai-compatible', baseUrl: OPENAI_COMPATIBLE_ENDPOINTS[provider.id] };
  }
  if (provider.npm === '@ai-sdk/openai-compatible' && typeof provider.api === 'string' && provider.api.startsWith('https://')) {
    return { adapter: 'openai-compatible', baseUrl: provider.api.replace(/\/$/, '') };
  }
  return null;
}

function compactModel(model) {
  const limit = model.limit && Number.isFinite(model.limit.context) ? Math.round(model.limit.context / 1000) : undefined;
  return {
    id: model.id,
    label: typeof model.name === 'string' && model.name.length > 0 ? model.name : model.id,
    ...(model.tool_call === true ? { toolCall: true } : {}),
    ...(model.reasoning === true ? { reasoning: true } : {}),
    ...(model.attachment === true ? { vision: true } : {}),
    ...(limit !== undefined && limit > 0 ? { contextK: limit } : {})
  };
}

async function loadSource() {
  const localPath = process.argv[2];
  if (localPath) return JSON.parse(readFileSync(resolve(localPath), 'utf8'));
  const response = await fetch('https://models.dev/api.json');
  if (!response.ok) throw new Error(`models.dev fetch failed with status ${response.status}`);
  return response.json();
}

const source = await loadSource();
const providers = [];
for (const provider of Object.values(source)) {
  const mapped = adapterFor(provider);
  if (mapped === null) continue;
  const models = Object.values(provider.models ?? {}).map(compactModel);
  if (models.length === 0) continue;
  models.sort((a, b) => a.label.localeCompare(b.label));
  const id = ID_OVERRIDES[provider.id] ?? provider.id;
  providers.push({
    id,
    label: provider.name ?? id,
    credentialKey: CREDENTIAL_OVERRIDES[id] ?? id,
    ...mapped,
    ...(typeof provider.doc === 'string' ? { doc: provider.doc } : {}),
    models
  });
}

providers.sort((a, b) => {
  const aPopular = POPULAR_ORDER.indexOf(a.id);
  const bPopular = POPULAR_ORDER.indexOf(b.id);
  if (aPopular !== -1 || bPopular !== -1) {
    if (aPopular === -1) return 1;
    if (bPopular === -1) return -1;
    return aPopular - bPopular;
  }
  return a.label.localeCompare(b.label);
});

const modelCount = providers.reduce((sum, provider) => sum + provider.models.length, 0);
const banner =
  `/* AUTO-GENERATED from the models.dev catalog (the source opencode uses).\n` +
  ` * Do not edit by hand — regenerate with: node scripts/generateLlmCatalog.mjs\n` +
  ` * Providers: ${providers.length} · Models: ${modelCount}\n` +
  ` */\n`;

const body =
  `${banner}\n` +
  `export type LlmCatalogModel = {\n` +
  `  readonly id: string;\n` +
  `  readonly label: string;\n` +
  `  readonly toolCall?: boolean;\n` +
  `  readonly reasoning?: boolean;\n` +
  `  readonly vision?: boolean;\n` +
  `  readonly contextK?: number;\n` +
  `};\n\n` +
  `export type LlmCatalogProvider = {\n` +
  `  readonly id: string;\n` +
  `  readonly label: string;\n` +
  `  readonly credentialKey: string;\n` +
  `  readonly adapter: 'openai-compatible' | 'anthropic' | 'gemini';\n` +
  `  readonly baseUrl?: string;\n` +
  `  readonly doc?: string;\n` +
  `  readonly models: readonly LlmCatalogModel[];\n` +
  `};\n\n` +
  `export const LLM_CATALOG: readonly LlmCatalogProvider[] = ${JSON.stringify(providers)};\n`;

await writeFile(OUTPUT, body, 'utf8');
console.log(`Wrote ${OUTPUT}: ${providers.length} providers, ${modelCount} models.`);
