import { clipDurationMs } from './timelineClipGeometry';
import type { TimelineDocument } from './timelineTypes';

export type TimelineSnapInput = {
  readonly timeline: TimelineDocument;
  readonly positionMs: number;
  readonly pixelsPerMs: number;
  readonly playheadMs: number;
  readonly enabled: boolean;
  readonly excludeClipId?: string;
  /** Moving a clip aligns either end. Trimming aligns only the dragged edge. */
  readonly movingDurationMs?: number;
};

/** Eight screen pixels, capped at 250ms so overview zoom cannot jump seconds. */
export function snapTimelinePosition(input: TimelineSnapInput): number {
  const position = Math.max(0, Math.round(Number.isFinite(input.positionMs) ? input.positionMs : 0));
  if (!input.enabled || !Number.isFinite(input.pixelsPerMs) || input.pixelsPerMs <= 0) return position;
  const tolerance = Math.min(250, 8 / input.pixelsPerMs);
  const targets = [input.playheadMs, 0];
  for (const track of input.timeline.tracks) {
    for (const clip of track.clips) {
      if (clip.id === input.excludeClipId) continue;
      targets.push(clip.timelineStartMs, clip.timelineStartMs + clipDurationMs(clip));
    }
  }
  const offsets = [0];
  if (input.movingDurationMs !== undefined && Number.isFinite(input.movingDurationMs) && input.movingDurationMs > 0) {
    offsets.push(input.movingDurationMs);
  }
  let best = position;
  let distance = Infinity;
  for (const target of targets) {
    if (!Number.isFinite(target) || target < 0) continue;
    for (const offset of offsets) {
      const candidate = Math.round(target - offset);
      const delta = Math.abs(candidate - position);
      if (candidate >= 0 && delta <= tolerance && delta < distance) {
        best = candidate;
        distance = delta;
      }
    }
  }
  return best;
}
