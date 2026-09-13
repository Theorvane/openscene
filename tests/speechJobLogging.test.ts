import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSpeechGenerationJob, getSpeechGenerationJob } from '../src/main/aiJobManager';

describe('speech job terminal diagnostics', () => {
  afterEach(() => vi.restoreAllMocks());

  it('reports lifecycle and failure details without printing narration content', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const secretNarration = 'SENSITIVE NARRATION MUST NEVER ENTER THE TERMINAL';
    const job = await createSpeechGenerationJob({ script: secretNarration, voiceId: 'alloy', modelId: 'tts-1' });

    await vi.waitFor(() => expect(getSpeechGenerationJob(job.id)?.status).toBe('failed'), { timeout: 3_000 });

    const output = [...info.mock.calls, ...error.mock.calls].flat().join('\n');
    expect(output).toContain(`[OpenScene][Speech][${job.id}] request.queued`);
    expect(output).toContain('process.started');
    expect(output).toContain('request.failed');
    expect(output).toContain(`"scriptCharacters":${secretNarration.length}`);
    expect(output).not.toContain(secretNarration);
  });
});
