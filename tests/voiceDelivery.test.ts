import { describe, expect, it } from 'vitest';
import { createEmptyAiProjectDocument } from '../src/shared/aiProjectDomain';
import { parseNarrationPlan } from '../src/shared/narrationPlan';
import { createNarrationPlan, updateNarrationPlan } from '../src/shared/subtitleWorkflow';
import { createVoiceDeliverySettings, parseVoiceDeliverySettings, voiceDeliveryCapabilities } from '../src/shared/voiceDelivery';

describe('expressive voice delivery', () => {
  it('keeps provider-facing performance text separate from clean captions', () => {
    const plan = createNarrationPlan({
      ai: createEmptyAiProjectDocument(), script: 'This stays in the captions.', durationMs: 5_000,
      voiceModelId: 'eleven_v3', voiceId: 'voice-1'
    });
    const approved = updateNarrationPlan(plan, {
      delivery: createVoiceDeliverySettings('[whispers] This stays in the captions.', { stability: 0.3 })
    }, true);

    expect(approved.script).toBe('This stays in the captions.');
    expect(approved.cues.map((cue) => cue.text).join(' ')).not.toContain('[whispers]');
    expect(approved.delivery?.performanceScript).toContain('[whispers]');
    expect(parseNarrationPlan(approved)).toEqual(approved);
  });

  it('keeps old saved narration plans valid and rejects unsafe delivery ranges', () => {
    const plan = createNarrationPlan({
      ai: createEmptyAiProjectDocument(), script: 'Legacy narration.', durationMs: 3_000,
      voiceModelId: 'eleven_multilingual_v2', voiceId: 'voice-1'
    });
    const { delivery: _delivery, ...legacy } = plan;
    expect(parseNarrationPlan(legacy)).not.toBeNull();
    expect(parseVoiceDeliverySettings({ ...plan.delivery, performanceScript: '', speed: 2 })).toBeNull();
    expect(parseNarrationPlan({ ...plan, delivery: { ...plan.delivery, speed: 2 } })).toBeNull();
  });

  it('reports only the controls actually supported by each runtime', () => {
    const elevenV3 = voiceDeliveryCapabilities('elevenlabs', 'eleven_v3');
    expect(elevenV3.cues.map((cue) => cue.token)).toContain('[laughs]');
    expect(elevenV3.supportsStability).toBe(true);
    expect(elevenV3.supportsAdvancedVoiceSettings).toBe(false);

    const elevenV2 = voiceDeliveryCapabilities('elevenlabs', 'eleven_multilingual_v2');
    expect(elevenV2.cues.map((cue) => cue.token)).toContain('<break time="0.5s" />');
    expect(elevenV2.supportsAdvancedVoiceSettings).toBe(true);

    const vieneu = voiceDeliveryCapabilities('vieneu_local', 'vieneu-v3-turbo');
    expect(vieneu.cues.map((cue) => cue.token)).toEqual(['[cười]', '[thở dài]', '[hắng giọng]']);
    expect(vieneu.supportsStability).toBe(false);
    expect(vieneu.supportsAdvancedVoiceSettings).toBe(false);
  });
});
