import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import { compileFfmpegTimeline, escapeDrawtext } from '../src/shared/ffmpegTimelineCompiler';
import { DEFAULT_TITLE_LENGTH_MS, addTitle, removeTitle, titleAt, updateTitle } from '../src/shared/timelineTitleLogic';
import { parseTimelineDocument } from '../src/shared/timelineDocumentValidators';
import { escapeFontPath, fontCandidates, supportsDrawtext } from '../src/shared/titleFont';
import { DEFAULT_CLIP_EFFECTS, PROJECT_SCHEMA_VERSION, TIMELINE_SCHEMA_VERSION } from '../src/shared/timelineTypes';

/**
 * Words on the picture.
 *
 * A title is not an asset, so it lives on the document rather than in a clip.
 * The parts worth pinning are the ones a renderer cannot recover from: a title
 * that rewrites the filter graph, a document that will not open because it
 * predates the feature, and an export that fails rather than saying it cannot
 * draw text.
 */

const title = {
  id: 't1',
  text: 'Hello',
  timelineStartMs: 0,
  timelineEndMs: 2000,
  sizePx: 48,
  color: '#ffcc00',
  positionX: 0,
  positionY: 0
};

const timeline = {
  schemaVersion: TIMELINE_SCHEMA_VERSION,
  transitions: [],
  titles: [title],
  tracks: [
    {
      id: 'v1',
      name: 'Video 1',
      kind: 'video',
      clips: [
        {
          id: 'c1',
          assetId: 'a',
          timelineStartMs: 0,
          sourceStartMs: 0,
          sourceEndMs: 3000,
          effects: { ...DEFAULT_CLIP_EFFECTS }
        }
      ]
    }
  ]
} as never;

describe('reading a document', () => {
  it('opens one written before titles existed', () => {
    // Absent and empty are the same thing; a project from last week is not
    // corrupt for lacking a key that did not exist.
    const parsed = parseTimelineDocument({
      schemaVersion: TIMELINE_SCHEMA_VERSION,
      transitions: [],
      tracks: []
    });
    // The key is left off entirely, so a document that had none is written back as it came.
    expect(parsed?.titles).toBeUndefined();
  });

  it('keeps a well-formed title', () => {
    const parsed = parseTimelineDocument({ schemaVersion: TIMELINE_SCHEMA_VERSION, transitions: [], tracks: [], titles: [title] });
    expect(parsed?.titles).toHaveLength(1);
  });

  it('refuses a title with no length, and one with a colour nothing agrees on', () => {
    // A zero-length title is a value no renderer can draw, and a colour every
    // renderer parses differently is a picture that differs per surface.
    for (const bad of [
      { ...title, timelineEndMs: title.timelineStartMs },
      { ...title, color: 'yellow' },
      { ...title, color: '#fc0' },
      { ...title, sizePx: 0 }
    ]) {
      expect(
        parseTimelineDocument({ schemaVersion: TIMELINE_SCHEMA_VERSION, transitions: [], tracks: [], titles: [bad] }),
        `${JSON.stringify(bad)} must be refused`
      ).toBeNull();
    }
  });
});

describe('drawing with FFmpeg', () => {
  const compile = (fontPath?: string) =>
    compileFfmpegTimeline({
      timeline,
      assetPaths: new Map([['a', '/tmp/a.mp4']]),
      ...(fontPath === undefined ? {} : { titleFontPath: fontPath }),
      outputPath: '/tmp/out.mp4',
      width: 640,
      height: 360,
      frameRate: 30
    });

  it('draws over the picture rather than into one clip', () => {
    const args = compile('/f.ttf').args.join(' ');
    expect(args).toContain('drawtext');
    expect(args).toContain("text='Hello'");
    expect(args).toContain('fontcolor=#ffcc00');
    expect(args).toContain("enable='between(t,0,2)'");
    // After the overlay chain and before the final format, so it is on top.
    expect(args.indexOf('drawtext')).toBeLessThan(args.indexOf('format=yuv420p'));
  });

  it('refuses by name when there is no font, rather than exporting without the words', () => {
    // Silently dropping the titles would hand someone a video that is missing
    // the thing they added last.
    expect(() => compile()).toThrow(/titles/i);
  });

  it('escapes what would otherwise rewrite the command', () => {
    // The filter graph is one string: a colon ends an option and a quote ends
    // the quoting, so a title containing them is an injection rather than text.
    expect(escapeDrawtext("a:b'c\\d")).toBe("a\\:b\\'c\\\\d");
    expect(escapeDrawtext('two\nlines')).toBe('two lines');
  });
});

describe('finding a font', () => {
  it('reads the filter listing rather than assuming the build', () => {
    // `drawtext` exists only where FFmpeg was compiled with libfreetype, and
    // the desktop renders with whichever binary the user has.
    expect(supportsDrawtext(' T.C drawtext          V->V       Draw text on top')).toBe(true);
    expect(supportsDrawtext(' T.C drawbox            V->V       Draw a box')).toBe(false);
  });

  it('looks where each platform keeps its faces', () => {
    expect(fontCandidates('darwin')[0]).toMatch(/^\/System\/Library\/Fonts\//);
    expect(fontCandidates('win32')[0]).toMatch(/^C:\\Windows\\Fonts\\/);
    expect(fontCandidates('linux')[0]).toMatch(/^\/usr\/share\/fonts\//);
  });

  it('spells a Windows path for the filter parser rather than the filesystem', () => {
    // Inside a filter string a backslash escapes and a colon ends an option.
    expect(escapeFontPath('C:\\Windows\\Fonts\\arial.ttf')).toBe('C\\:/Windows/Fonts/arial.ttf');
  });
});

describe('editing titles', () => {
  const empty = { schemaVersion: TIMELINE_SCHEMA_VERSION, transitions: [], tracks: [] } as never;

  it('adds one at the playhead, with a length someone can read', () => {
    const next = addTitle(empty, { id: 't1', atMs: 1500 });
    expect(next.titles).toHaveLength(1);
    expect(next.titles?.[0]).toMatchObject({ timelineStartMs: 1500, timelineEndMs: 1500 + DEFAULT_TITLE_LENGTH_MS });
  });

  it('refuses a change that leaves nothing to draw', () => {
    // The same answer the clip rules give: the caller keeps what it had and can
    // say why, rather than silently getting something it did not ask for.
    const one = addTitle(empty, { id: 't1', atMs: 0 });
    expect(updateTitle(one, 't1', { timelineEndMs: 0 })).toBeNull();
    expect(updateTitle(one, 't1', { sizePx: 0 })).toBeNull();
    expect(updateTitle(one, 't1', { color: 'red' })).toBeNull();
    expect(updateTitle(one, 'missing', { text: 'x' })).toBeNull();
  });

  it('keeps a change that makes sense', () => {
    const one = addTitle(empty, { id: 't1', atMs: 0 });
    expect(updateTitle(one, 't1', { text: 'Chapter one' })?.titles?.[0]?.text).toBe('Chapter one');
  });

  it('finds the title under the playhead, and none outside it', () => {
    const one = addTitle(empty, { id: 't1', atMs: 1000 });
    expect(titleAt(one, 1000)?.id).toBe('t1');
    expect(titleAt(one, 999)).toBeNull();
    // Exclusive at the end, the way a clip is: two titles back to back must not
    // both claim the frame between them.
    expect(titleAt(one, 1000 + DEFAULT_TITLE_LENGTH_MS)).toBeNull();
  });

  it('removes one, and refuses to remove what is not there', () => {
    const one = addTitle(empty, { id: 't1', atMs: 0 });
    expect(removeTitle(one, 't1')?.titles).toEqual([]);
    expect(removeTitle(one, 'missing')).toBeNull();
  });
});

/**
 * The half of titles that only a device can check.
 *
 * The first Android build hid a title outside its window by returning empty
 * text from the overlay, which is the obvious reading of the API and drew the
 * caption correctly — for two seconds. Then the export died with "Video frame
 * processing error" and left a truncated file, because empty text is a
 * zero-sized bitmap the frame processor cannot draw. Nothing in this suite saw
 * it; exporting on an emulator did.
 *
 * So the shape of the fix is asserted here: the text is constant and the alpha
 * is what changes. It is a source assertion rather than a behavioural one, which
 * is weak — but it is the difference between the next person having to
 * rediscover this by watching an export fail, and reading why in a test.
 */
describe('the titles the native modules draw', () => {
  const read = (path: string) => readFile(new URL(`../mobile/${path}`, import.meta.url), 'utf8');

  it('hides an Android title with alpha rather than with empty text', async () => {
    const kotlin = await read(
      'modules/video-export/android/src/main/java/expo/modules/videoexport/VideoExportModule.kt'
    );
    expect(kotlin).toContain('setAlphaScale(alpha)');
    expect(kotlin).toContain('override fun getText(presentationTimeUs: Long): SpannableString = span');
    // The zero-sized bitmap that truncated the export.
    expect(kotlin).not.toContain('SpannableString("")');
  });

  it('draws them on iOS over the finished picture', async () => {
    const swift = await read('modules/video-export/ios/VideoExportModule.swift');
    expect(swift).toContain('CATextLayer');
    expect(swift).toContain('AVVideoCompositionCoreAnimationTool');
  });
});
