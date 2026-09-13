import { describe, expect, it } from 'vitest';

import { compileFfmpegTimeline } from '../src/main/ffmpegTimelineCompiler';
import { DEFAULT_AUDIO_TRACK_MIX, DEFAULT_CLIP_EFFECTS, TIMELINE_SCHEMA_VERSION } from '../src/shared/timelineTypes';
import type { TimelineDocument } from '../src/shared/timelineTypes';

const TIMELINE: TimelineDocument = {
  schemaVersion: TIMELINE_SCHEMA_VERSION,
  tracks: [
    {
      id: 'video-track',
      name: 'Video',
      kind: 'video',
      clips: [{
        id: 'video-clip',
        assetId: 'video-asset',
        timelineStartMs: 500,
        sourceStartMs: 1_000,
        sourceEndMs: 3_000,
        sourceDurationMs: 5_000,
        effects: { ...DEFAULT_CLIP_EFFECTS, opacity: 0.75 },
        keyframes: []
      }]
    },
    {
      id: 'audio-track',
      name: 'Audio',
      kind: 'audio',
      mix: { ...DEFAULT_AUDIO_TRACK_MIX, gainDb: -3 },
      clips: [{
        id: 'audio-clip',
        assetId: 'audio-asset',
        timelineStartMs: 250,
        sourceStartMs: 100,
        sourceEndMs: 1_100,
        sourceDurationMs: 2_000,
        effects: { ...DEFAULT_CLIP_EFFECTS, volume: 0.5 },
        keyframes: []
      }]
    }
  ],
  transitions: []
};

describe('FFmpeg timeline compiler', () => {
  it('builds literal argv for trimmed v3 video/audio clips and fixed H.264/AAC MP4 output', () => {
    const compiled = compileFfmpegTimeline({
      timeline: TIMELINE,
      assetPaths: new Map([
        ['video-asset', '/project/assets/video original.webm'],
        ['audio-asset', '/project/assets/audio;$(touch never).wav']
      ]),
      outputPath: '/exports/export_01.mp4',
      width: 1280,
      height: 720,
      frameRate: 30
    });

    expect(compiled.durationMs).toBe(2_500);
    expect(compiled.args).toContain('/project/assets/video original.webm');
    expect(compiled.args).toContain('/project/assets/audio;$(touch never).wav');
    expect(compiled.args).toContain('libx264');
    expect(compiled.args).toContain('aac');
    expect(compiled.args).toContain('file,pipe');
    expect(compiled.args).toContain('/exports/export_01.mp4');
    expect(compiled.args.join(' ')).toContain('trim=start=1:end=3');
    expect(compiled.args.join(' ')).toContain('adelay=250:all=1');
    expect(compiled.args.join(' ')).toContain('colorchannelmixer=aa=0.75');
    expect(compiled.args.join(' ')).toContain('volume=0.35397289');
  });

  it('rejects an empty timeline and unresolved assets', () => {
    expect(() => compileFfmpegTimeline({
      timeline: { schemaVersion: TIMELINE_SCHEMA_VERSION, tracks: [], transitions: [] },
      assetPaths: new Map(),
      outputPath: '/exports/export_01.mp4',
      width: 1280,
      height: 720,
      frameRate: 30
    })).toThrow('Timeline has no media to export.');
    expect(() => compileFfmpegTimeline({
      timeline: TIMELINE,
      assetPaths: new Map(),
      outputPath: '/exports/export_01.mp4',
      width: 1280,
      height: 720,
      frameRate: 30
    })).toThrow('Timeline asset video-asset is unavailable.');
  });

  it('clears only allowlisted personal tags for Privacy Clean and requests no removal for Preserve Provenance', () => {
    const input = {
      timeline: TIMELINE,
      assetPaths: new Map([
        ['video-asset', '/project/video.webm'],
        ['audio-asset', '/project/audio.wav']
      ]),
      outputPath: '/exports/export_01.mp4',
      width: 1280,
      height: 720,
      frameRate: 30
    } as const;
    const preserved = compileFfmpegTimeline({ ...input, metadataPrivacyMode: 'preserve_provenance' });
    const cleaned = compileFfmpegTimeline({ ...input, metadataPrivacyMode: 'privacy_clean' });

    expect(preserved.args).not.toContain('-metadata');
    expect(cleaned.args).toContain('author=');
    expect(cleaned.args).toContain('com.apple.quicktime.location.ISO6709=');
    expect(cleaned.args).not.toContain('copyright=');
    expect(cleaned.args.join(' ')).not.toMatch(/c2pa=|synthid=/i);
    expect(cleaned.args.at(-1)).toBe(input.outputPath);
  });
});
