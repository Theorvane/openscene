export type CopilotTool = 'createVideoJob' | 'createSpeechJob' | 'exportProjectVideo';

export const INTENT_SYSTEM_PROMPT =
  'You are a timeline command router for a video editor. Given a user instruction, respond with ONLY ' +
  'a JSON object (no prose, no markdown fences) of the exact shape ' +
  '{"tool": "createVideoJob" | "createSpeechJob" | "exportProjectVideo" | null, "reason": "<one short sentence>"}. ' +
  'Use createVideoJob to generate/insert a video clip or scene, createSpeechJob to synthesize voiceover/narration/speech, ' +
  'exportProjectVideo to export/render/save the project as a video file, or null if the instruction matches none of these.';

export function matchKeywordIntent(lowerCaseText: string): CopilotTool | null {
  if (lowerCaseText.includes('voice') || lowerCaseText.includes('speech') || lowerCaseText.includes('narration') || lowerCaseText.includes('보이스')) {
    return 'createSpeechJob';
  }
  if (lowerCaseText.includes('export') || lowerCaseText.includes('render') || lowerCaseText.includes('익스포트') || lowerCaseText.includes('저장')) {
    return 'exportProjectVideo';
  }
  if (lowerCaseText.includes('video') || lowerCaseText.includes('intro') || lowerCaseText.includes('scene') || lowerCaseText.includes('영상')) {
    return 'createVideoJob';
  }
  return null;
}

/** Parses the model's JSON intent reply. Returns undefined (not null) when the reply cannot be parsed at all,
 * so callers can distinguish "model said no tool applies" from "model output was unusable". */
export function parseModelIntent(rawCompletion: string): { tool: CopilotTool | null; reason?: string } | undefined {
  const stripped = rawCompletion.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  try {
    const parsed = JSON.parse(stripped) as { tool?: unknown; reason?: unknown };
    const validTools: readonly CopilotTool[] = ['createVideoJob', 'createSpeechJob', 'exportProjectVideo'];
    const tool = typeof parsed.tool === 'string' && (validTools as readonly string[]).includes(parsed.tool) ? (parsed.tool as CopilotTool) : null;
    return typeof parsed.reason === 'string' ? { tool, reason: parsed.reason } : { tool };
  } catch {
    return undefined;
  }
}
