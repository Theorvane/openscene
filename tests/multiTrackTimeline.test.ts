import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { compileFfmpegTimeline } from '../src/main/ffmpegTimelineCompiler';
import {
  INITIAL_AUDIO_TRACK_ID,
  INITIAL_VIDEO_TRACK_ID,
  addTrack,
  createInitialTimeline,
  addTrackBeside,
  removeTrack,
  renameTrack
} from '../src/shared/timelineLogic';
import { DEFAULT_CLIP_EFFECTS, TRANSITION_TYPES, type PersistedTimelineClip, type TimelineDocument } from '../src/shared/timelineTypes';

function clip(id: string, assetId: string, startMs: number): PersistedTimelineClip {
  return {
    id,
    assetId,
    timelineStartMs: startMs,
    sourceStartMs: 0,
    sourceEndMs: 2_000,
    sourceDurationMs: 2_000,
    effects: { ...DEFAULT_CLIP_EFFECTS },
    keyframes: []
  };
}

function withVideoTracks(): TimelineDocument {
  const base = createInitialTimeline();
  const added = addTrack(base, { id: 'video-2', name: 'Video 2', kind: 'video' });
  if (added === null) throw new Error('addTrack should accept a second video track');
  return added;
}

describe('track lifecycle', () => {
  it('adds tracks of either kind', () => {
    // Given / When
    const timeline = withVideoTracks();
    const withAudio = addTrack(timeline, { id: 'audio-2', name: 'Audio 2', kind: 'audio' });

    // Then
    expect(timeline.tracks.map((track) => track.id)).toEqual([INITIAL_VIDEO_TRACK_ID, INITIAL_AUDIO_TRACK_ID, 'video-2']);
    expect(withAudio?.tracks).toHaveLength(4);
  });

  it('refuses to remove the last track of a kind', () => {
    // Given
    const base = createInitialTimeline();

    // When / Then
    // Removing it would leave imports of that kind with nowhere to land and the
    // editor with no row to drop onto.
    expect(removeTrack(base, INITIAL_VIDEO_TRACK_ID)).toBeNull();
    expect(removeTrack(base, INITIAL_AUDIO_TRACK_ID)).toBeNull();
    expect(removeTrack(base, 'no-such-track')).toBeNull();
  });

  it('removes a spare track and drops transitions that referenced its clips', () => {
    // Given
    const timeline = withVideoTracks();
    const populated: TimelineDocument = {
      ...timeline,
      tracks: timeline.tracks.map((track: (typeof timeline.tracks)[number]) =>
        track.id === 'video-2' ? { ...track, clips: [clip('c9', 'asset-1', 0)] } : track
      ),
      transitions: [{ fromClipId: 'c9', toClipId: 'c9', type: TRANSITION_TYPES[0], durationMs: 500 }]
    };

    // When
    const removed = removeTrack(populated, 'video-2');

    // Then
    expect(removed?.tracks.map((track) => track.id)).toEqual([INITIAL_VIDEO_TRACK_ID, INITIAL_AUDIO_TRACK_ID]);
    // A transition pointing at a clip that just left would dangle.
    expect(removed?.transitions).toEqual([]);
  });

  it('renames a track, rejecting empty and over-long names', () => {
    // Given
    const base = createInitialTimeline();

    // When / Then
    expect(renameTrack(base, INITIAL_VIDEO_TRACK_ID, '  Overlay  ')?.tracks[0]?.name).toBe('Overlay');
    expect(renameTrack(base, INITIAL_VIDEO_TRACK_ID, '   ')).toBeNull();
    expect(renameTrack(base, INITIAL_VIDEO_TRACK_ID, 'x'.repeat(81))).toBeNull();
    expect(renameTrack(base, 'nope', 'Overlay')).toBeNull();
  });
});

describe('inserting a track beside another', () => {
  it('inserts above, which is the higher video layer', () => {
    // Given
    const timeline = createInitialTimeline();

    // When
    const next = addTrackBeside(
      timeline,
      { trackId: INITIAL_VIDEO_TRACK_ID, position: 'above' },
      { id: 'video-2', name: 'Overlay', kind: 'video' }
    );

    // Then
    // Order is layer order, so "above" has to mean earlier in the array.
    expect(next?.tracks.map((track) => track.id)).toEqual(['video-2', INITIAL_VIDEO_TRACK_ID, INITIAL_AUDIO_TRACK_ID]);
  });

  it('inserts below the reference track', () => {
    // Given / When
    const next = addTrackBeside(
      createInitialTimeline(),
      { trackId: INITIAL_VIDEO_TRACK_ID, position: 'below' },
      { id: 'video-2', name: 'Video 2', kind: 'video' }
    );

    // Then
    expect(next?.tracks.map((track) => track.id)).toEqual([INITIAL_VIDEO_TRACK_ID, 'video-2', INITIAL_AUDIO_TRACK_ID]);
  });

  it('applies the same validation as appending', () => {
    // Given
    const timeline = createInitialTimeline();

    // When / Then
    // Reusing addTrack for validation is the point: the id, name, and duplicate
    // rules cannot drift between appending and inserting.
    expect(addTrackBeside(timeline, { trackId: INITIAL_VIDEO_TRACK_ID, position: 'above' }, { id: 'bad id', name: 'X', kind: 'video' })).toBeNull();
    expect(addTrackBeside(timeline, { trackId: INITIAL_VIDEO_TRACK_ID, position: 'above' }, { id: 'ok', name: '  ', kind: 'video' })).toBeNull();
    expect(addTrackBeside(timeline, { trackId: INITIAL_VIDEO_TRACK_ID, position: 'above' }, { id: INITIAL_AUDIO_TRACK_ID, name: 'Dup', kind: 'audio' })).toBeNull();
  });

  it('returns null for an unknown reference track', () => {
    expect(addTrackBeside(createInitialTimeline(), { trackId: 'nope', position: 'above' }, { id: 'video-2', name: 'V2', kind: 'video' })).toBeNull();
  });
});

describe('video layer order in the export', () => {
  it('composites the top timeline row as the topmost layer', () => {
    // Given
    const timeline = withVideoTracks();
    const populated: TimelineDocument = {
      ...timeline,
      tracks: timeline.tracks.map((track) => {
        if (track.id === INITIAL_VIDEO_TRACK_ID) return { ...track, clips: [clip('top', 'asset-top', 0)] };
        if (track.id === 'video-2') return { ...track, clips: [clip('bottom', 'asset-bottom', 0)] };
        return track;
      })
    };

    // When
    const { args } = compileFfmpegTimeline({
      timeline: populated,
      assetPaths: new Map([
        ['asset-top', '/tmp/top.mp4'],
        ['asset-bottom', '/tmp/bottom.mp4']
      ]),
      outputPath: '/tmp/out.mp4',
      width: 1920,
      height: 1080,
      frameRate: 30
    });
    const filter = args[args.indexOf('-filter_complex') + 1] ?? '';

    // Then
    // FFmpeg stacks each overlay on top of the last, so the bottom row must be
    // laid down first for the top row to end up on top. Compositing in array
    // order inverts the layers — invisible with one video track, wrong with two.
    const inputs = args.filter((arg, index) => args[index - 1] === '-i');
    const topInput = inputs.indexOf('/tmp/top.mp4');
    const bottomInput = inputs.indexOf('/tmp/bottom.mp4');
    const bottomFirst = filter.indexOf(`[${bottomInput}:v:0]`);
    const topLater = filter.indexOf(`[${topInput}:v:0]`);
    expect(bottomFirst).toBeGreaterThan(-1);
    expect(topLater).toBeGreaterThan(bottomFirst);
  });

  it('still exports a single-video-track timeline unchanged', () => {
    // Given
    const base = createInitialTimeline();
    const populated: TimelineDocument = {
      ...base,
      tracks: base.tracks.map((track) => (track.kind === 'video' ? { ...track, clips: [clip('a', 'asset-a', 0)] } : track))
    };

    // When
    const { args } = compileFfmpegTimeline({
      timeline: populated,
      assetPaths: new Map([['asset-a', '/tmp/a.mp4']]),
      outputPath: '/tmp/out.mp4',
      width: 1920,
      height: 1080,
      frameRate: 30
    });

    // Then
    expect(args[args.indexOf('-filter_complex') + 1]).toContain('[video-out]');
  });
});

describe('timeline rail geometry', () => {
  it('measures the ruler, tracks, and playhead from one rail constant', () => {
    // Given
    const source = readFileSync(resolve(process.cwd(), 'src/renderer/src/editor/TimelineCanvas.tsx'), 'utf8');

    // Then
    // The width used to be written out five times, including inside the
    // playhead's calc(). Any one of them drifting puts the ruler out of step
    // with the clips underneath it, which is what "the layout went weird" is.
    expect(source).toContain('export const TRACK_RAIL_WIDTH');
    expect(source).not.toMatch(/'104px minmax/);
    // The ruler and the track rows; the add strip that was the third user is gone.
    expect(source.match(/gridTemplateColumns: TRACK_GRID_TEMPLATE/g)?.length).toBeGreaterThanOrEqual(2);
    expect(source).toContain('${TRACK_RAIL_WIDTH} + (100% -');
  });

  it('keeps the track header to two rows so it fits the shortest track', () => {
    // Given
    const source = readFileSync(resolve(process.cwd(), 'src/renderer/src/editor/TimelineCanvas.tsx'), 'utf8');

    // Then
    // Audio rows are 42px. A third row of 18px controls overflowed them, which
    // is the regression this pins.
    expect(source).toContain("gridTemplateRows: 'auto auto'");
    expect(source).not.toContain("gridTemplateRows: 'auto auto auto'");
  });
});

describe('timeline fills its panel', () => {
  it('stretches the surface to the bottom instead of stopping under the last track', () => {
    // Given
    const source = readFileSync(resolve(process.cwd(), 'src/renderer/src/editor/TimelineCanvas.tsx'), 'utf8');

    // Then
    // A content-height grid left dead space below the last track, and the
    // playhead — which is positioned against this element — stopped there too.
    expect(source).toContain("minHeight: '100%'");
    expect(source).toContain("flexDirection: 'column'");
    expect(source).toContain("flex: '1 1 auto'");
  });
});

describe('flex column hazards', () => {
  it('stops the ruler and track rows from being shrunk by the flex column', () => {
    // Given
    const source = readFileSync(resolve(process.cwd(), 'src/renderer/src/editor/TimelineCanvas.tsx'), 'utf8');

    // Then
    // Flex children shrink by default where grid rows did not. The lane inside
    // each row has min-height 72px, so a shrunk row lets the lane overflow and
    // paint its background across the clips on the row below.
    expect(source.match(/flexShrink: 0/g)?.length).toBeGreaterThanOrEqual(2);
  });
});
