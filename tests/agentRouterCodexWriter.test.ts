import { existsSync } from 'node:fs';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';

import { requestAgentRouterCodexWriter, type AgentRouterCodexRunner } from '../src/main/agentRouterCodexWriter';
import type { WriterDraft, WriterRequest } from '../src/shared/writerWorkflow';

const request: WriterRequest = {
  mode: 'content_to_script', sourceText: 'A private brief.', language: 'Vietnamese',
  audience: 'Creators', tone: 'Clear', targetDurationSeconds: 30
};
const draft: WriterDraft = {
  title: 'Creator tool', screenplay: 'A creator opens the tool.', characters: [],
  styleBible: { palette: [], lighting: '', cameraGrammar: '', texture: '', forbiddenChanges: [] },
  scenes: [{
    title: 'Open', objective: 'Introduce the tool.', setting: 'Studio', timeOfDay: 'Day',
    characterNames: [], continuityNotes: '',
    shots: [{
      durationSeconds: 8, framing: 'Medium', cameraMotion: 'Static', action: 'The tool opens.',
      dialogue: '', audioCues: [], negativePrompt: ''
    }]
  }]
};

describe('AgentRouter Codex Writer bridge', () => {
  it('uses an ephemeral read-only Codex Responses client and validates its last message', async () => {
    let isolatedCwd = '';
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const runCli = vi.fn<AgentRouterCodexRunner>(async (input) => {
      isolatedCwd = input.cwd;
      expect(existsSync(input.cwd)).toBe(true);
      expect(input.args).toContain('exec');
      expect(input.args).toContain('--ignore-user-config');
      expect(input.args).toContain('--ephemeral');
      expect(input.args).toContain('model_provider="agentrouter"');
      expect(input.args).toContain('model_providers.agentrouter.wire_api="responses"');
      expect(input.args).toContain('model_providers.agentrouter.request_max_retries=0');
      expect(input.args).toContain('model_providers.agentrouter.stream_max_retries=0');
      expect(input.args.join(' ')).not.toContain('router-secret');
      expect(input.args.join(' ')).not.toContain(request.sourceText);
      expect(input.stdin).toContain(request.sourceText);
      expect(input.stdin).not.toContain('"framing":{"type":"string"}');
      expect(input.env.AGENT_ROUTER_TOKEN).toBe('router-secret');
      const outputIndex = input.args.indexOf('-o');
      const resultPath = input.args[outputIndex + 1];
      expect(resultPath).toBeTruthy();
      const schemaIndex = input.args.indexOf('--output-schema');
      const schemaPath = input.args[schemaIndex + 1];
      expect(schemaPath).toBeTruthy();
      expect(JSON.parse(await readFile(schemaPath!, 'utf8'))).toMatchObject({
        required: ['title', 'screenplay', 'characters', 'styleBible', 'scenes']
      });
      await writeFile(resultPath!, JSON.stringify(draft), 'utf8');
      input.onProgress?.({ type: 'started', pid: 123 });
      input.onProgress?.({ type: 'codex_event', eventType: 'thread.started' });
      input.onProgress?.({ type: 'codex_event', eventType: 'item.completed', itemType: 'agent_message' });
      input.onProgress?.({ type: 'heartbeat', elapsedMs: 10_000, stdoutBytes: 100, stderrBytes: 0 });
      return { exitCode: 0, stdout: '', stderr: '' };
    });
    try {
      await expect(requestAgentRouterCodexWriter({
        apiKey: 'router-secret', modelId: 'agentrouter/gpt-5.6-sol', request, executable: 'codex-test.exe', runCli
      })).resolves.toEqual(draft);
      expect(existsSync(isolatedCwd)).toBe(false);
      const logs = info.mock.calls.flat().join('\n');
      expect(logs).toContain('codex-cli-responses');
      expect(logs).toContain('item.completed');
      expect(logs).not.toContain('router-secret');
      expect(logs).not.toContain(request.sourceText);
    } finally {
      info.mockRestore();
    }
  });

  it('extracts and redacts Codex JSONL errors even when the CLI exits with code zero', async () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const privateModelOutput = 'private generated screenplay fragment';
    const runCli: AgentRouterCodexRunner = async () => ({
      exitCode: 0,
      stdout: [
        JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: privateModelOutput } }),
        JSON.stringify({ type: 'error', message: `Rejected router-secret for ${request.sourceText}` })
      ].join('\n'),
      stderr: ''
    });
    try {
      await expect(requestAgentRouterCodexWriter({
        apiKey: 'router-secret', modelId: 'agentrouter/glm-5.3', request, executable: 'codex-test.exe', runCli
      })).rejects.toThrow('Rejected [REDACTED] for [REDACTED_INPUT]');
      const logs = errorLog.mock.calls.flat().join('\n');
      expect(logs).not.toContain(privateModelOutput);
      expect(logs).not.toContain('router-secret');
    } finally {
      errorLog.mockRestore();
    }
  });

  it('turns a provider content block into an actionable error without exposing the payload', async () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const runCli: AgentRouterCodexRunner = async () => ({
      exitCode: 1,
      stdout: JSON.stringify({
        type: 'turn.failed',
        error: { message: '{"error":{"code":"content-blocked","message":"content-blocked (request id: safe123)"}}' }
      }),
      stderr: ''
    });
    try {
      await expect(requestAgentRouterCodexWriter({
        apiKey: 'router-secret', modelId: 'agentrouter/glm-5.3', request,
        executable: 'codex-test.exe', runCli
      })).rejects.toThrow('AgentRouter blocked the request before the model generated a response');
      const logs = errorLog.mock.calls.flat().join('\n');
      expect(logs).toContain('Request ID: safe123');
      expect(logs).not.toContain(request.sourceText);
      expect(logs).not.toContain('router-secret');
    } finally {
      errorLog.mockRestore();
    }
  });

  it('does not replace a valid draft when Windows keeps the temp directory busy', async () => {
    let isolatedCwd = '';
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const runCli: AgentRouterCodexRunner = async (input) => {
      isolatedCwd = input.cwd;
      const resultPath = input.args[input.args.indexOf('-o') + 1]!;
      await writeFile(resultPath, `\`\`\`json\n${JSON.stringify(draft)}\n\`\`\``, 'utf8');
      return { exitCode: 0, stdout: '', stderr: '' };
    };
    const busyCleanup = vi.fn(async () => {
      throw Object.assign(new Error('resource busy or locked'), { code: 'EBUSY' });
    });
    try {
      await expect(requestAgentRouterCodexWriter({
        apiKey: 'router-secret', modelId: 'agentrouter/deepseek-v4-flash', request,
        executable: 'codex-test.exe', runCli, removeTempDirectory: busyCleanup
      })).resolves.toEqual(draft);
      expect(warning.mock.calls.flat().join('\n')).toContain('EBUSY');
    } finally {
      warning.mockRestore();
      if (isolatedCwd) await rm(isolatedCwd, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
  });

  it('recovers when the model prepends prose before the markdown fence (loose fence strategy)', async () => {
    let isolatedCwd = '';
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const runCli: AgentRouterCodexRunner = async (input) => {
      isolatedCwd = input.cwd;
      const resultPath = input.args[input.args.indexOf('-o') + 1]!;
      // Model added an acknowledgement sentence before the fence — a common pattern
      // with non-OpenAI providers routed through AgentRouter.
      const withProse = `Here is the requested JSON output:\n\`\`\`json\n${JSON.stringify(draft)}\n\`\`\``;
      await writeFile(resultPath, withProse, 'utf8');
      return { exitCode: 0, stdout: '', stderr: '' };
    };
    try {
      await expect(requestAgentRouterCodexWriter({
        apiKey: 'router-secret', modelId: 'agentrouter/gpt-5.6-sol', request,
        executable: 'codex-test.exe', runCli
      })).resolves.toEqual(draft);
    } finally {
      info.mockRestore();
      if (isolatedCwd) await rm(isolatedCwd, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
  });

  it('recovers when the model wraps JSON in prose without a fence (object extraction strategy)', async () => {
    let isolatedCwd = '';
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const runCli: AgentRouterCodexRunner = async (input) => {
      isolatedCwd = input.cwd;
      const resultPath = input.args[input.args.indexOf('-o') + 1]!;
      // Model returned prose with the JSON object embedded inline.
      const withProse = `Sure! Here is the draft: ${JSON.stringify(draft)} — let me know if you need changes.`;
      await writeFile(resultPath, withProse, 'utf8');
      return { exitCode: 0, stdout: '', stderr: '' };
    };
    try {
      await expect(requestAgentRouterCodexWriter({
        apiKey: 'router-secret', modelId: 'agentrouter/glm-5.3', request,
        executable: 'codex-test.exe', runCli
      })).resolves.toEqual(draft);
    } finally {
      info.mockRestore();
      if (isolatedCwd) await rm(isolatedCwd, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
  });

  it('fails when Codex exits successfully without a last-message file', async () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      await expect(requestAgentRouterCodexWriter({
        apiKey: 'router-secret', modelId: 'agentrouter/gpt-5.6-sol', request, executable: 'codex-test.exe',
        runCli: async () => ({ exitCode: 0, stdout: '', stderr: '' })
      })).rejects.toThrow('without returning a Writer result');
    } finally {
      errorLog.mockRestore();
    }
  });
});
