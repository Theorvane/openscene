import { describe, expect, it } from 'vitest';
import { createEmptyAiProjectDocument, parseAiProjectDocument } from '../src/shared/aiProjectDomain';
import { parseNarrationPlan } from '../src/shared/narrationPlan';
import { applySubtitleCues, createNarrationPlan, narrationFingerprint, narrationFromApprovedWriter, narrationPlanMatchesWriter, SUBTITLE_LIMITS, updateNarrationPlan } from '../src/shared/subtitleWorkflow';
import { voiceChoices } from '../src/shared/voiceCatalog';
import { parseTimelineDocument } from '../src/shared/timelineDocumentValidators';
import { createInitialTimeline } from '../src/shared/timelineLogic';
import type { WriterDraft } from '../src/shared/writerWorkflow';
import { applyCaptionPreset } from '../src/shared/captionStyle';

const draft: WriterDraft = {
  title: 'Yelling', screenplay: 'Approved screenplay', characters: [{ name: 'Grog', invariantDescription: 'Red hide' }],
  styleBible: { palette: [], lighting: '', cameraGrammar: '', texture: '', forbiddenChanges: [] },
  scenes: [{ title: 'The post', objective: 'Invent posting', setting: 'Cave', timeOfDay: 'Day', characterNames: ['Grog'], continuityNotes: '', shots: [
    { durationSeconds: 4, framing: 'Wide', cameraMotion: 'Locked', action: 'Grog yells.', dialogue: 'Grog: I found dinner!', audioCues: [], negativePrompt: '' },
    { durationSeconds: 8, framing: 'Close', cameraMotion: 'Push', action: 'He reveals a mouse.', dialogue: 'Narrator: It was not a mammoth. Everyone knew.', audioCues: [], negativePrompt: '' }
  ] }]
};
function writerAi() {
  const empty = createEmptyAiProjectDocument();
  const appliedScriptId = 'script-approved';
  return { ...empty,
    scripts: [{ id: appliedScriptId, title: 'Yelling', sourceKind: 'idea' as const, sourceText: 'idea', screenplay: 'Approved screenplay', status: 'draft' as const, createdAt: '2026-09-05T00:00:00.000Z' }],
    writerPipeline: { requestJson: '{}', appliedScriptId, artifacts: [
      { stage: 'concept' as const, title: 'c', content: 'c', approved: true, modelId: 'm' },
      { stage: 'screenplay' as const, title: 's', content: 's', approved: true, modelId: 'm' },
      { stage: 'breakdown' as const, title: 'b', content: 'b', approved: true, modelId: 'm' },
      { stage: 'prompts' as const, title: 'p', content: JSON.stringify(draft), approved: true, modelId: 'm' }
    ] }
  };
}

describe('narration and automatic subtitles', () => {
  it('extracts only spoken lines from approved Writer shots and keeps shot timing', () => {
    const source = narrationFromApprovedWriter(writerAi())!;
    expect(source.script).toBe('I found dinner!\nIt was not a mammoth. Everyone knew.');
    expect(source.cues[0]).toMatchObject({ startMs: 0, endMs: 4_000, text: 'I found dinner!' });
    expect(source.cues[1]?.startMs).toBe(4_000);
    expect(source.cues.at(-1)!.endMs).toBeLessThanOrEqual(12_000);
    expect(Math.max(...source.cues.map((cue) => cue.endMs - cue.startMs))).toBeLessThanOrEqual(SUBTITLE_LIMITS.maxCueMs);
  });

  it('does not mistake ordinary colon punctuation in manually pasted narration for a speaker label', () => {
    const plan = createNarrationPlan({ ai: createEmptyAiProjectDocument(), script: 'Remember this: quality needs review.', durationMs: 4_000, voiceModelId: 'tts-1', voiceId: 'alloy' });
    expect(plan.script).toContain('Remember this:');
    expect(plan.cues.map((cue) => cue.text).join(' ')).toContain('Remember this:');
  });

  it('creates readable non-overlapping cues and validates manual timing edits', () => {
    const plan = createNarrationPlan({ ai: createEmptyAiProjectDocument(), script: 'This is a deliberately long caption sentence that should wrap into at most two readable lines for viewers. Then it changes.', durationMs: 20_000, voiceModelId: 'tts-1', voiceId: 'nova' });
    expect(plan.cues.length).toBeGreaterThan(1);
    expect(plan.cues.every((cue) => cue.text.replace('\n', '').length <= SUBTITLE_LIMITS.maxCharsPerLine * 2)).toBe(true);
    expect(parseNarrationPlan({ ...plan, cues: [plan.cues[0], { ...plan.cues[1]!, startMs: plan.cues[0]!.endMs - 1 }] })).toBeNull();
    expect(parseNarrationPlan({ ...plan, cues: plan.cues.map((cue, index) => index === 0 ? { ...cue, text: 'Different spoken words.' } : cue) })).toBeNull();
    expect(() => updateNarrationPlan(plan, { cues: [{ ...plan.cues[0]!, text: '' }] }, true)).toThrow('invalid');
  });

  it('never silently drops dense narration when the requested duration is short', () => {
    const script = Array.from({ length: 20 }, (_, index) => `Sentence number ${index + 1} carries useful narration.`).join(' ');
    const plan = createNarrationPlan({ ai: createEmptyAiProjectDocument(), script, durationMs: 1_000, voiceModelId: 'tts-1', voiceId: 'alloy' });
    expect(plan.cues.map((cue) => cue.text.replace('\n', ' ')).join(' ')).toBe(script);
    expect(plan.cues.every((cue) => cue.endMs > cue.startMs)).toBe(true);
  });

  it('persists a reviewed plan with the AI project and detects changed Writer source', () => {
    const ai = writerAi(); const plan = createNarrationPlan({ ai, durationMs: 12_000, voiceModelId: 'eleven_v3', voiceId: 'voice' });
    const approved = updateNarrationPlan(plan, {}, true);
    const parsed = parseAiProjectDocument({ ...ai, narrationPlan: approved });
    expect(parsed?.narrationPlan).toEqual(approved);
    expect(parseAiProjectDocument({ ...ai, scripts: [], narrationPlan: approved })).toBeNull();
    expect(narrationPlanMatchesWriter(ai, approved)).toBe(true);
    const changedDraft = { ...draft, scenes: [{ ...draft.scenes[0]!, shots: [{ ...draft.scenes[0]!.shots[0]!, dialogue: 'Grog: Changed.' }] }] };
    const changedAi = { ...ai, writerPipeline: { ...ai.writerPipeline, artifacts: ai.writerPipeline.artifacts.map((a) => a.stage === 'prompts' ? { ...a, content: JSON.stringify(changedDraft) } : a) } };
    expect(narrationPlanMatchesWriter(changedAi, approved)).toBe(false);
    expect(() => updateNarrationPlan(approved, { script: `${approved.script} Custom.` }, false)).toThrow('invalid');
    const lastEndMs = approved.cues.at(-1)!.endMs;
    const detached = updateNarrationPlan(approved, { script: `${approved.script} Custom.`, cues: [...approved.cues, { id: 'custom-cue', text: 'Custom.', startMs: lastEndMs, endMs: lastEndMs + 1_000 }] }, false);
    expect(detached.sourceScriptId).toBeUndefined();
  });

  it('requires approval before replacing prior automatic captions and preserves manual titles', () => {
    const draftPlan = createNarrationPlan({ ai: createEmptyAiProjectDocument(), script: 'First. Second.', durationMs: 5_000, voiceModelId: 'tts-1', voiceId: 'alloy' });
    expect(() => applySubtitleCues(createInitialTimeline(), draftPlan)).toThrow('Approve');
    const plan = updateNarrationPlan(draftPlan, {}, true);
    const priorCaption = applyCaptionPreset({ id: 'auto-caption-old-1', text: 'Old', timelineStartMs: 0, timelineEndMs: 1_000, sizePx: 64, color: '#ffffff', positionX: 0, positionY: 0 }, 'boxed');
    const timeline = { ...createInitialTimeline(), titles: [{ id: 'manual-title', text: 'Manual', timelineStartMs: 0, timelineEndMs: 1_000, sizePx: 72, color: '#ffffff', positionX: 0, positionY: 0 }, priorCaption] };
    const applied = applySubtitleCues(timeline, plan);
    expect(applied.titles?.some((title) => title.id === 'manual-title')).toBe(true);
    expect(applied.titles?.some((title) => title.id === 'auto-caption-old-1')).toBe(false);
    expect(applied.titles?.filter((title) => title.id.startsWith(`auto-caption-${narrationFingerprint(plan.script)}`))).toHaveLength(plan.cues.length);
    expect(applied.titles?.find((title) => title.id.startsWith('auto-caption-'))?.style).toEqual(priorCaption.style);
    expect(parseTimelineDocument(applied)).not.toBeNull();
  });

  it('exposes only voices accepted by existing provider adapters', () => {
    expect(voiceChoices('openai').map((voice) => voice.id)).toEqual(['alloy', 'ash', 'coral', 'echo', 'fable', 'nova', 'onyx', 'sage', 'shimmer']);
    expect(voiceChoices('elevenlabs')).toHaveLength(5);
    expect(voiceChoices('vieneu_local')).toEqual([]);
    expect(voiceChoices('google_gemini')).toEqual([]);
  });
});
