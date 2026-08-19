import { describe, expect, it } from 'vitest';

import { audioProbeArgs, probeSaysAudible } from '../src/shared/audibleAssets';
import { buildCompositionPlan } from '../src/shared/videoCompositionPlan';
import { compileFfmpegTimeline } from '../src/shared/ffmpegTimelineCompiler';
import { DEFAULT_CLIP_EFFECTS, PROJECT_SCHEMA_VERSION, type TimelineDocument } from '../src/shared/timelineTypes';

/**
 * A video clip's own sound.
 *
 * It was dropped everywhere: the plan built `audioSegments` from audio tracks
 * only, so importing a clip of someone talking, trimming it and exporting gave
 * back a silent file. `effects.volume` had been on every clip the whole time,
 * and the Adjust panel had been offering it, for something that never happened.
 */

function timelineWith(clip: { assetId: string; startMs: number; volume?: number }): TimelineDocument {
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    tracks: [
      {
        id: 'video-1',
        name: 'Video 1',
        kind: 'video',
        clips: [
          {
            id: 'clip-1',
            assetId: clip.assetId,
            timelineStartMs: clip.startMs,
            sourceStartMs: 0,
            sourceEndMs: 4000,
            effects: { ...DEFAULT_CLIP_EFFECTS, volume: clip.volume ?? 1 }
          }
        ],
        transitions: []
      }
    ],
    transitions: []
  } as unknown as TimelineDocument;
}

describe('a video clip carries its own sound', () => {
  it('places it when the source has some', () => {
    const plan = buildCompositionPlan({
      timeline: timelineWith({ assetId: 'a', startMs: 500 }),
      width: 1920,
      height: 1080,
      frameRate: 30,
      audibleAssetIds: new Set(['a'])
    });
    expect(plan.audioSegments).toHaveLength(1);
    expect(plan.audioSegments[0]).toMatchObject({ timelineStartMs: 500, sourceStartMs: 0, sourceEndMs: 4000, gain: 1 });
  });

  it('places none when the source is silent', () => {
    // Emitting one is not a cosmetic mistake: FFmpeg's graph fails on a missing
    // `[i:a]`, and Media3 handed a video-only source with the video removed has
    // nothing left to encode.
    const plan = buildCompositionPlan({
      timeline: timelineWith({ assetId: 'a', startMs: 0 }),
      width: 1920,
      height: 1080,
      frameRate: 30,
      audibleAssetIds: new Set()
    });
    expect(plan.audioSegments).toHaveLength(0);
  });

  it('places none when nobody said, which is every project exported before this', () => {
    const plan = buildCompositionPlan({
      timeline: timelineWith({ assetId: 'a', startMs: 0 }),
      width: 1920,
      height: 1080,
      frameRate: 30
    });
    expect(plan.audioSegments).toHaveLength(0);
  });

  it('takes the gain from the clip alone, because a video track has no fader', () => {
    const plan = buildCompositionPlan({
      timeline: timelineWith({ assetId: 'a', startMs: 0, volume: 0.5 }),
      width: 1920,
      height: 1080,
      frameRate: 30,
      audibleAssetIds: new Set(['a'])
    });
    expect(plan.audioSegments[0]?.gain).toBe(0.5);
  });

  it('places none for a clip silenced to zero', () => {
    const plan = buildCompositionPlan({
      timeline: timelineWith({ assetId: 'a', startMs: 0, volume: 0 }),
      width: 1920,
      height: 1080,
      frameRate: 30,
      audibleAssetIds: new Set(['a'])
    });
    expect(plan.audioSegments).toHaveLength(0);
  });
});

describe('the FFmpeg graph', () => {
  const compile = (audible: ReadonlySet<string>) =>
    compileFfmpegTimeline({
      timeline: timelineWith({ assetId: 'a', startMs: 1000 }),
      assetPaths: new Map([['a', '/tmp/a.mp4']]),
      audibleAssetIds: audible,
      outputPath: '/tmp/out.mp4',
      width: 1920,
      height: 1080,
      frameRate: 30
    });

  it('mixes the clip audio and encodes a track', () => {
    const args = compile(new Set(['a'])).args.join(' ');
    expect(args).toContain('atrim=start=0:end=4');
    expect(args).toContain('adelay=1000:all=1');
    expect(args).toContain('amix=inputs=1');
    expect(args).toContain('-c:a aac');
  });

  it('asks for no audio stream at all when the source is silent', () => {
    // The whole point: referencing `[0:a:0]` on a source without one fails the
    // export rather than losing a track.
    const args = compile(new Set()).args.join(' ');
    expect(args).not.toContain(':a:0]');
    expect(args).not.toContain('amix');
    expect(args).not.toContain('-c:a');
  });
});

describe('the audio probe', () => {
  it('asks FFmpeg for the first audio stream and decodes none of it', () => {
    expect(audioProbeArgs('/tmp/a.mp4')).toEqual([
      '-v', 'error', '-i', '/tmp/a.mp4', '-map', '0:a:0', '-t', '0', '-f', 'null', '-'
    ]);
  });

  it('treats anything but a clean exit as silent', () => {
    // Losing the sound of a file nothing could read costs a track that was
    // already unreachable; guessing the other way costs the export.
    expect(probeSaysAudible(0)).toBe(true);
    expect(probeSaysAudible(1)).toBe(false);
    expect(probeSaysAudible(null)).toBe(false);
  });
});
