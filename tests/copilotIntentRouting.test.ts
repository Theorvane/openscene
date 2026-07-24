import { describe, expect, it } from 'vitest';
import { matchKeywordIntent, parseModelIntent } from '../src/renderer/src/copilotIntent';

describe('Copilot LLM intent parsing', () => {
  it('parses a well-formed JSON tool response from the model', () => {
    const result = parseModelIntent('{"tool": "createVideoJob", "reason": "User asked for a video."}');
    expect(result).toEqual({ tool: 'createVideoJob', reason: 'User asked for a video.' });
  });

  it('strips markdown code fences before parsing', () => {
    const result = parseModelIntent('```json\n{"tool": "exportProjectVideo"}\n```');
    expect(result).toEqual({ tool: 'exportProjectVideo' });
  });

  it('treats an explicit null tool as "no operation matched", not a parse failure', () => {
    const result = parseModelIntent('{"tool": null, "reason": "Instruction is unrelated to editing."}');
    expect(result).toEqual({ tool: null, reason: 'Instruction is unrelated to editing.' });
  });

  it('returns undefined for output that is not valid JSON, signaling a fallback is needed', () => {
    expect(parseModelIntent('Sure, I can help you make a video!')).toBeUndefined();
  });

  it('normalizes an unrecognized tool name to null instead of trusting arbitrary model output', () => {
    const result = parseModelIntent('{"tool": "deleteEverything"}');
    expect(result).toEqual({ tool: null });
  });

  it('routes keyword fallback commands to the correct tool', () => {
    expect(matchKeywordIntent('create a cinematic video intro')).toBe('createVideoJob');
    expect(matchKeywordIntent('synthesize a voiceover narration')).toBe('createSpeechJob');
    expect(matchKeywordIntent('export the project as mp4')).toBe('exportProjectVideo');
    expect(matchKeywordIntent('what is the weather today')).toBeNull();
  });
});
