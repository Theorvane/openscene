import { timelineDurationMs } from '../shared/timelineLogic';
import type { AudioTimelineTrack, PersistedTimelineClip, TimelineDocument } from '../shared/timelineTypes';

export type CompileFfmpegTimelineInput = {
  readonly timeline: TimelineDocument;
  readonly assetPaths: ReadonlyMap<string, string>;
  readonly outputPath: string;
  readonly width: number;
  readonly height: number;
  readonly frameRate: number;
};

export type CompiledFfmpegTimeline = {
  readonly args: readonly string[];
  readonly durationMs: number;
};

export class FfmpegTimelineError extends Error {
  override readonly name = 'FfmpegTimelineError';
}

function seconds(milliseconds: number): string {
  return Number((milliseconds / 1_000).toFixed(6)).toString();
}

function requireAssetPath(assetPaths: ReadonlyMap<string, string>, assetId: string): string {
  const path = assetPaths.get(assetId);
  if (path === undefined || path.includes('\0')) {
    throw new FfmpegTimelineError(`Timeline asset ${assetId} is unavailable.`);
  }
  return path;
}

function videoFilter(clip: PersistedTimelineClip, inputIndex: number, outputLabel: string): string {
  const start = seconds(clip.sourceStartMs);
  const end = seconds(clip.sourceEndMs);
  const offset = seconds(clip.timelineStartMs);
  const rotation = Number((clip.effects.rotation * Math.PI / 180).toFixed(8));
  return [
    `[${inputIndex}:v:0]trim=start=${start}:end=${end}`,
    `setpts=PTS-STARTPTS+${offset}/TB`,
    `scale=w='iw*${clip.effects.scale}':h='ih*${clip.effects.scale}'`,
    'format=rgba',
    `rotate=${rotation}:fillcolor=black@0`,
    `colorchannelmixer=aa=${clip.effects.opacity}[${outputLabel}]`
  ].join(',');
}

function trackGain(track: AudioTimelineTrack, clip: PersistedTimelineClip): number {
  if (track.mix.muted) {
    return 0;
  }
  return Number((clip.effects.volume * 10 ** (track.mix.gainDb / 20)).toFixed(8));
}

function audioFilter(track: AudioTimelineTrack, clip: PersistedTimelineClip, inputIndex: number, outputLabel: string): string {
  const pan = track.mix.pan;
  const left = Number((pan > 0 ? 1 - pan : 1).toFixed(8));
  const right = Number((pan < 0 ? 1 + pan : 1).toFixed(8));
  return [
    `[${inputIndex}:a:0]atrim=start=${seconds(clip.sourceStartMs)}:end=${seconds(clip.sourceEndMs)}`,
    'asetpts=PTS-STARTPTS',
    `volume=${trackGain(track, clip)}`,
    'aformat=channel_layouts=stereo',
    `pan=stereo|c0=${left}*c0|c1=${right}*c1`,
    `adelay=${clip.timelineStartMs}:all=1[${outputLabel}]`
  ].join(',');
}

export function compileFfmpegTimeline(input: CompileFfmpegTimelineInput): CompiledFfmpegTimeline {
  const durationMs = timelineDurationMs(input.timeline);
  if (durationMs <= 0) {
    throw new FfmpegTimelineError('Timeline has no media to export.');
  }

  const args: string[] = [
    '-hide_banner', '-nostdin', '-n',
    '-protocol_whitelist', 'file,pipe',
    '-progress', 'pipe:1', '-nostats'
  ];
  const filters: string[] = [];
  const videoClips: Array<{ readonly clip: PersistedTimelineClip; readonly inputIndex: number }> = [];
  const audioClips: Array<{ readonly track: AudioTimelineTrack; readonly clip: PersistedTimelineClip; readonly inputIndex: number }> = [];
  let inputIndex = 0;
  // Inputs are declared in timeline order so -i indexes stay stable and
  // predictable; layer order is decided separately, below.
  const videoLayers: Array<Array<{ readonly clip: PersistedTimelineClip; readonly inputIndex: number }>> = [];
  for (const track of input.timeline.tracks) {
    const layer: Array<{ readonly clip: PersistedTimelineClip; readonly inputIndex: number }> = [];
    for (const clip of track.clips) {
      args.push('-i', requireAssetPath(input.assetPaths, clip.assetId));
      if (track.kind === 'video') {
        if (clip.effects.opacity > 0 && clip.effects.scale > 0) {
          layer.push({ clip, inputIndex });
        }
      } else {
        audioClips.push({ track, clip, inputIndex });
      }
      inputIndex += 1;
    }
    if (track.kind === 'video') videoLayers.push(layer);
  }

  // tracks[0] is the top row in the timeline, and every NLE treats the higher
  // track as the higher layer. FFmpeg stacks each overlay on top of the last, so
  // the rows are composited bottom-first to put the top row on top. Building the
  // chain in array order — as this did — silently inverts the layers, which is
  // invisible with one video track and wrong with two.
  for (const layer of [...videoLayers].reverse()) {
    videoClips.push(...layer);
  }

  filters.push(`color=c=black:s=${input.width}x${input.height}:r=${input.frameRate}:d=${seconds(durationMs)}[video-base]`);
  let currentVideoLabel = 'video-base';
  videoClips.forEach(({ clip, inputIndex: clipInputIndex }, index) => {
    const clipLabel = `video-clip-${index}`;
    const nextLabel = `video-layer-${index}`;
    filters.push(videoFilter(clip, clipInputIndex, clipLabel));
    const endMs = clip.timelineStartMs + clip.sourceEndMs - clip.sourceStartMs;
    const x = `(main_w-overlay_w)/2+${clip.effects.positionX}`;
    const y = `(main_h-overlay_h)/2+${clip.effects.positionY}`;
    filters.push(`[${currentVideoLabel}][${clipLabel}]overlay=x='${x}':y='${y}':enable='between(t,${seconds(clip.timelineStartMs)},${seconds(endMs)})':eof_action=pass[${nextLabel}]`);
    currentVideoLabel = nextLabel;
  });
  filters.push(`[${currentVideoLabel}]format=yuv420p[video-out]`);

  const audioLabels: string[] = [];
  audioClips.forEach(({ track, clip, inputIndex: clipInputIndex }, index) => {
    const label = `audio-clip-${index}`;
    filters.push(audioFilter(track, clip, clipInputIndex, label));
    audioLabels.push(`[${label}]`);
  });
  if (audioLabels.length > 0) {
    filters.push(`${audioLabels.join('')}amix=inputs=${audioLabels.length}:duration=longest:normalize=0[audio-out]`);
  }

  args.push('-filter_complex', filters.join(';'), '-map', '[video-out]');
  if (audioLabels.length > 0) {
    args.push('-map', '[audio-out]', '-c:a', 'aac', '-b:a', '192k');
  } else {
    args.push('-an');
  }
  args.push(
    '-c:v', 'libx264',
    '-preset', 'medium',
    '-crf', '20',
    '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    '-t', seconds(durationMs),
    input.outputPath
  );
  return { args, durationMs };
}
