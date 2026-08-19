/**
 * Builds the FFmpeg argument list for a timeline. Pure — it returns args and
 * never runs anything, which is why it belongs in shared: the desktop hands the
 * result to a spawned binary, and a phone can hand the same result to an FFmpeg
 * binding without the composition logic being written twice.
 */
import { timelineDurationMs } from './timelineLogic';
import type { AudioTimelineTrack, PersistedTimelineClip, TimelineDocument, TransitionDescriptor } from './timelineTypes';

export type CompileFfmpegTimelineInput = {
  readonly timeline: TimelineDocument;
  readonly assetPaths: ReadonlyMap<string, string>;
  /**
   * Which assets are stills, by id.
   *
   * A still has no timeline of its own: opened the way a movie is opened it
   * yields a single frame, and the overlay it feeds runs for that one frame
   * instead of the length of its clip. `-loop 1 -t` is FFmpeg's way of saying
   * "hold this". Absent means nothing is a still, which is what every project
   * written before stills existed means.
   */
  readonly stillAssetIds?: ReadonlySet<string>;
  /**
   * Ids of assets that carry an audio stream.
   *
   * A video clip's own sound is part of the clip and is placed like any other
   * audio — but only where there is some. `[i:a:0]` on a source without an audio
   * stream fails the whole graph, and a still never has one, so a clip whose
   * asset is not named here contributes picture only.
   *
   * Absent means none, which is what every export before this did: a cut came
   * out silent unless somebody had separately placed an audio clip.
   */
  readonly audibleAssetIds?: ReadonlySet<string>;
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

function findClip(timeline: TimelineDocument, clipId: string): PersistedTimelineClip | null {
  for (const track of timeline.tracks) {
    const clip = track.clips.find((candidate) => candidate.id === clipId);
    if (clip !== undefined) return clip;
  }
  return null;
}

function clipEndMs(clip: PersistedTimelineClip): number {
  return clip.timelineStartMs + (clip.sourceEndMs - clip.sourceStartMs);
}

function requireAssetPath(assetPaths: ReadonlyMap<string, string>, assetId: string): string {
  const path = assetPaths.get(assetId);
  if (path === undefined || path.includes('\0')) {
    throw new FfmpegTimelineError(`Timeline asset ${assetId} is unavailable.`);
  }
  return path;
}

function videoFilter(
  clip: PersistedTimelineClip,
  inputIndex: number,
  outputLabel: string,
  fades: readonly string[] = []
): string {
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
    // The transition ramps come after the clip's own opacity, so they scale it
    // rather than replace it: a clip held at 50% still dips to nothing.
    `colorchannelmixer=aa=${clip.effects.opacity}`,
    ...fades
  ].join(',') + `[${outputLabel}]`;
}

/**
 * A video clip's own sound, which has no track fader behind it.
 *
 * An audio track carries a mix — gain, pan, mute — and a video track does not,
 * so the clip's own volume is the whole story. Written as its own function
 * rather than a null-check inside the other, because "there is no mix" is a
 * different fact from "the mix is neutral".
 */
function clipOnlyGain(clip: PersistedTimelineClip): number {
  return Number(clip.effects.volume.toFixed(8));
}

function videoAudioFilter(clip: PersistedTimelineClip, inputIndex: number, outputLabel: string): string {
  return [
    `[${inputIndex}:a:0]atrim=start=${seconds(clip.sourceStartMs)}:end=${seconds(clip.sourceEndMs)}`,
    'asetpts=PTS-STARTPTS',
    `volume=${clipOnlyGain(clip)}`,
    'aformat=channel_layouts=stereo',
    `adelay=${clip.timelineStartMs}:all=1[${outputLabel}]`
  ].join(',');
}

/**
 * The alpha ramps a transition puts on the clips either side of a cut.
 *
 * Timed the way the program monitor times them: the window is the cut plus and
 * minus half the duration, the outgoing clip fades to nothing over the first
 * half, and the incoming clip arrives over the second. The base layer is black,
 * so what a viewer sees is a dip through black — which is what adjacent clips
 * can honestly do. They do not overlap on the timeline (the rules refuse it), so
 * there is no instant where both have a picture to dissolve between.
 *
 * `fade` rather than `colorchannelmixer`, because the mixer takes a constant and
 * a transition is the one thing here that is not one. The timestamps are
 * timeline time: `setpts` has already offset the clip by then.
 */
function transitionFades(clip: PersistedTimelineClip, transitions: readonly TransitionDescriptor[]): readonly string[] {
  const fades: string[] = [];
  for (const transition of transitions) {
    // A dip to black is drawn as its own layer over the finished picture, the
    // way the preview draws it — the clips keep their own opacity.
    if (transition.type === 'dipToBlack') continue;
    const halfMs = transition.durationMs / 2;
    if (halfMs <= 0) continue;
    if (transition.fromClipId === clip.id) {
      const startMs = clipEndMs(clip) - halfMs;
      fades.push(`fade=t=out:st=${seconds(startMs)}:d=${seconds(halfMs)}:alpha=1`);
    }
    if (transition.toClipId === clip.id) {
      fades.push(`fade=t=in:st=${seconds(clip.timelineStartMs)}:d=${seconds(halfMs)}:alpha=1`);
    }
  }
  return fades;
}

/**
 * A dip to black, as a black layer that arrives and leaves.
 *
 * Over everything rather than inside one clip: the preview draws it as a scrim
 * across the whole frame, so a second video track underneath dips too. Matching
 * that matters more than the fact that a per-clip fade would have been shorter
 * to write — an export that disagrees with the preview is the bug this whole
 * change exists to fix.
 */
function dipToBlackFilters(
  transition: TransitionDescriptor,
  cutMs: number,
  input: { readonly width: number; readonly height: number; readonly frameRate: number },
  inputLabel: string,
  sourceLabel: string,
  outputLabel: string
): readonly string[] {
  const halfMs = transition.durationMs / 2;
  const startMs = cutMs - halfMs;
  return [
    [
      `color=c=black:s=${input.width}x${input.height}:r=${input.frameRate}:d=${seconds(transition.durationMs)}`,
      'format=rgba',
      `fade=t=in:st=0:d=${seconds(halfMs)}:alpha=1`,
      `fade=t=out:st=${seconds(halfMs)}:d=${seconds(halfMs)}:alpha=1`,
      `setpts=PTS-STARTPTS+${seconds(startMs)}/TB[${sourceLabel}]`
    ].join(','),
    `[${inputLabel}][${sourceLabel}]overlay=x=0:y=0:enable='between(t,${seconds(startMs)},${seconds(cutMs + halfMs)})':eof_action=pass[${outputLabel}]`
  ];
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
  /** Video clips that carry sound of their own; see `audibleAssetIds`. */
  const videoAudioClips: Array<{ readonly clip: PersistedTimelineClip; readonly inputIndex: number }> = [];
  let inputIndex = 0;
  // Inputs are declared in timeline order so -i indexes stay stable and
  // predictable; layer order is decided separately, below.
  const videoLayers: Array<Array<{ readonly clip: PersistedTimelineClip; readonly inputIndex: number }>> = [];
  for (const track of input.timeline.tracks) {
    const layer: Array<{ readonly clip: PersistedTimelineClip; readonly inputIndex: number }> = [];
    for (const clip of track.clips) {
      // The hold has to cover the clip, and the clip cannot run past its source
      // — which for a still is the hold itself — so the two are the same number.
      if (input.stillAssetIds?.has(clip.assetId) === true) {
        args.push('-loop', '1', '-t', seconds(clip.sourceEndMs - clip.sourceStartMs));
      }
      args.push('-i', requireAssetPath(input.assetPaths, clip.assetId));
      if (track.kind === 'video') {
        if (clip.effects.opacity > 0 && clip.effects.scale > 0) {
          layer.push({ clip, inputIndex });
        }
        // Sound is placed whatever the picture is doing: a clip faded to nothing
        // still carries its voice, which is how a cutaway works.
        if (input.audibleAssetIds?.has(clip.assetId) === true && clip.effects.volume > 0) {
          videoAudioClips.push({ clip, inputIndex });
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
    filters.push(videoFilter(clip, clipInputIndex, clipLabel, transitionFades(clip, input.timeline.transitions)));
    const endMs = clip.timelineStartMs + clip.sourceEndMs - clip.sourceStartMs;
    const x = `(main_w-overlay_w)/2+${clip.effects.positionX}`;
    const y = `(main_h-overlay_h)/2+${clip.effects.positionY}`;
    filters.push(`[${currentVideoLabel}][${clipLabel}]overlay=x='${x}':y='${y}':enable='between(t,${seconds(clip.timelineStartMs)},${seconds(endMs)})':eof_action=pass[${nextLabel}]`);
    currentVideoLabel = nextLabel;
  });
  // Dips to black go over the finished picture, in cut order so two of them
  // cannot fight over the same label.
  const dips = input.timeline.transitions.filter((transition) => transition.type === 'dipToBlack');
  dips.forEach((transition, index) => {
    const toClip = findClip(input.timeline, transition.toClipId);
    if (toClip === null) return;
    const nextLabel = `video-dip-${index}`;
    filters.push(
      ...dipToBlackFilters(transition, toClip.timelineStartMs, input, currentVideoLabel, `dip-source-${index}`, nextLabel)
    );
    currentVideoLabel = nextLabel;
  });

  filters.push(`[${currentVideoLabel}]format=yuv420p[video-out]`);

  const audioLabels: string[] = [];
  audioClips.forEach(({ track, clip, inputIndex: clipInputIndex }, index) => {
    const label = `audio-clip-${index}`;
    filters.push(audioFilter(track, clip, clipInputIndex, label));
    audioLabels.push(`[${label}]`);
  });
  videoAudioClips.forEach(({ clip, inputIndex: clipInputIndex }, index) => {
    const label = `video-audio-${index}`;
    filters.push(videoAudioFilter(clip, clipInputIndex, label));
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
