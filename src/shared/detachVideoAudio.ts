import { addTrack, placeClip, updateClipEffects } from './timelineLogic';
import { DEFAULT_CLIP_EFFECTS } from './timelineTypes';
import type { MediaAsset, PersistedTimelineClip, TimelineDocument } from './timelineTypes';

export type DetachVideoAudioTimelineInput = {
  readonly sourceClipId: string;
  readonly audioAsset: MediaAsset;
  readonly audioClipId: string;
  readonly fallbackAudioTrackId: string;
  readonly fallbackAudioTrackName: string;
};

export type DetachVideoAudioTimelineResult = {
  readonly timeline: TimelineDocument;
  readonly audioClip: PersistedTimelineClip;
  readonly audioTrackId: string;
};

/**
 * Places extracted audio beside its source picture and silences the embedded
 * stream in one immutable timeline transaction.
 *
 * The audio inherits source trim, speed, gain automation and timeline start,
 * so detaching a trimmed or retimed clip cannot move its sound out of sync.
 */
export function detachVideoAudioOnTimeline(
  timeline: TimelineDocument,
  input: DetachVideoAudioTimelineInput
): DetachVideoAudioTimelineResult | null {
  const sourceTrack = timeline.tracks.find((track) => track.clips.some((clip) => clip.id === input.sourceClipId));
  const sourceClip = sourceTrack?.clips.find((clip) => clip.id === input.sourceClipId);
  const audioDurationMs = input.audioAsset.metadata?.durationMs;
  if (
    sourceTrack?.kind !== 'video' ||
    sourceClip === undefined ||
    input.audioAsset.kind !== 'audio' ||
    audioDurationMs === undefined ||
    audioDurationMs < sourceClip.sourceEndMs
  ) {
    return null;
  }

  const volumeKeyframes = sourceClip.keyframes.filter((keyframe) => keyframe.property === 'volume');
  const audioClip: PersistedTimelineClip = {
    id: input.audioClipId,
    assetId: input.audioAsset.id,
    timelineStartMs: sourceClip.timelineStartMs,
    sourceStartMs: sourceClip.sourceStartMs,
    sourceEndMs: sourceClip.sourceEndMs,
    sourceDurationMs: audioDurationMs,
    effects: {
      ...DEFAULT_CLIP_EFFECTS,
      volume: sourceClip.effects.volume,
      ...(sourceClip.effects.speed === undefined ? {} : { speed: sourceClip.effects.speed })
    },
    keyframes: volumeKeyframes
  };

  let placed: TimelineDocument | null = null;
  let audioTrackId = '';
  for (const track of timeline.tracks) {
    if (track.kind !== 'audio') continue;
    const candidate = placeClip(timeline, { trackId: track.id, clip: audioClip });
    if (candidate !== null) {
      placed = candidate;
      audioTrackId = track.id;
      break;
    }
  }

  if (placed === null) {
    const withTrack = addTrack(timeline, {
      id: input.fallbackAudioTrackId,
      name: input.fallbackAudioTrackName,
      kind: 'audio'
    });
    if (withTrack === null) return null;
    placed = placeClip(withTrack, { trackId: input.fallbackAudioTrackId, clip: audioClip });
    audioTrackId = input.fallbackAudioTrackId;
  }
  if (placed === null) return null;

  let muted = updateClipEffects(placed, { clipId: sourceClip.id, effects: { volume: 0 } });
  if (muted === null) return null;
  // A volume keyframe overrides the base effect at playback time. Preserve the
  // automation on the detached audio, but zero it on the picture clip.
  muted = {
    ...muted,
    tracks: muted.tracks.map((track) => ({
      ...track,
      clips: track.clips.map((clip) => clip.id !== sourceClip.id
        ? clip
        : {
            ...clip,
            keyframes: clip.keyframes.map((keyframe) => keyframe.property === 'volume'
              ? { ...keyframe, value: 0 }
              : keyframe)
          })
    }))
  };

  return { timeline: muted, audioClip, audioTrackId };
}
