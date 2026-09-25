import type { AiProjectDocument } from './aiProjectDomain';
import type { ProductionEditorAsset } from './productionEditor';
import type { TimelineDocument } from './timelineTypes';
import { productionShotRows } from './productionWorkflow';
import { narrationFromApprovedWriter, narrationPlanMatchesWriter } from './subtitleWorkflow';

/** Evidence only: existing media does not imply approval or synchronization. */
export function productionCompanions(document: AiProjectDocument, assets: readonly ProductionEditorAsset[], timeline?: TimelineDocument | null) {
  const rows = productionShotRows(document);
  const frames = rows.filter(row => assets.some(asset => asset.id === row.storyboardReference?.assetId && asset.kind === 'image')).length;
  const audio = assets.filter(asset => asset.kind === 'audio');
  const placed = new Set((timeline?.tracks ?? []).filter(track => track.kind === 'audio').flatMap(track => track.clips.map(clip => clip.assetId)));
  const narration = document.narrationPlan;
  const dialogue = narrationFromApprovedWriter(document);
  const voiceState = narration && !narrationPlanMatchesWriter(document, narration) ? 'outdated'
    : narration?.status ?? (dialogue ? 'available' : 'empty');
  const voiceMessage = voiceState === 'outdated' ? 'The narration belongs to an earlier plan. Reload dialogue and review timing.'
    : voiceState === 'approved' ? `${narration!.cues.length} caption cues approved. Approval does not mean captions are applied or speech is generated.`
    : voiceState === 'draft' ? `${narration!.cues.length} draft caption cues. Review text, voice and timing before approval.`
    : voiceState === 'available' ? `${dialogue!.cues.length} dialogue cues ready to load from the approved plan.`
    : 'No approved dialogue yet. You can write optional narration in the voice tool.';
  return {
    frames, shots: rows.length, voiceState, voiceMessage,
    audioAssets: audio.length, placedAudioAssets: audio.filter(asset => placed.has(asset.id)).length
  };
}
