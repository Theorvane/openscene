import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import {
  MAX_THUMBNAILS,
  MIN_THUMBNAIL_WIDTH_PX,
  THUMBNAIL_SLOT_PX,
  thumbnailKey,
  thumbnailTimesMs
} from '../src/shared/clipThumbnails';

/**
 * Both surfaces sample the same moments, or the same project is two different
 * timelines to look at.
 */
describe('which frames a clip shows', () => {
  const clip = { sourceStartMs: 1_000, sourceEndMs: 5_000 };

  it('samples the middle of each slot, so a strip does not open on black', () => {
    // 4s across two slots: the middles are at 2s and 4s from the source start.
    expect(thumbnailTimesMs(clip, THUMBNAIL_SLOT_PX * 2)).toEqual([2_000, 4_000]);
  });

  it('shows one frame rather than none on a clip too narrow for two', () => {
    expect(thumbnailTimesMs(clip, MIN_THUMBNAIL_WIDTH_PX)).toEqual([3_000]);
  });

  it('shows none at all when there is no room for a frame', () => {
    expect(thumbnailTimesMs(clip, MIN_THUMBNAIL_WIDTH_PX - 1)).toEqual([]);
    expect(thumbnailTimesMs(clip, 0)).toEqual([]);
  });

  it('stops counting long before a zoomed-in hour of footage decodes for minutes', () => {
    expect(thumbnailTimesMs(clip, THUMBNAIL_SLOT_PX * 500)).toHaveLength(MAX_THUMBNAILS);
  });

  it('reads a clip as a window into its source, wherever the clip sits', () => {
    // Moving a clip along the timeline does not change which frames it shows.
    expect(thumbnailTimesMs({ sourceStartMs: 0, sourceEndMs: 4_000 }, THUMBNAIL_SLOT_PX * 2)).toEqual([1_000, 3_000]);
  });

  it('refuses a clip with no length rather than dividing by zero', () => {
    expect(thumbnailTimesMs({ sourceStartMs: 500, sourceEndMs: 500 }, 400)).toEqual([]);
  });
});

describe('the cache key', () => {
  it('rounds, so nudging a clip by a frame does not decode everything again', () => {
    expect(thumbnailKey('asset-1', 2_040)).toBe(thumbnailKey('asset-1', 1_960));
    expect(thumbnailKey('asset-1', 2_040)).not.toBe(thumbnailKey('asset-2', 2_040));
    expect(thumbnailKey('asset-1', 2_040)).not.toBe(thumbnailKey('asset-1', 2_400));
  });
});

/**
 * Both surfaces draw them, and both ask the shared rule which frames to draw.
 *
 * Source assertions, which are weak evidence — but the alternative is a
 * thumbnail that quietly comes back only on one surface, and this is the check
 * that noticed nothing when the clip effects went missing three times over.
 */
describe('the two timelines', () => {
  const readMobile = (path: string) => readFile(new URL(`../mobile/${path}`, import.meta.url), 'utf8');
  const readDesktop = (path: string) => readFile(new URL(`../src/${path}`, import.meta.url), 'utf8');

  it('samples with the shared rule rather than each inventing its own', async () => {
    expect(await readMobile('src/lib/thumbnails.ts')).toContain("from '@openvideo/shared/clipThumbnails'");
    expect(await readDesktop('renderer/src/editor/clipThumbnails.ts')).toContain("from '../../../shared/clipThumbnails'");
  });

  it('draws them on the phone, with the media the clip actually points at', async () => {
    const clip = await readMobile('src/components/TimelineClip.tsx');
    expect(clip).toContain('useClipThumbnails');
    expect(await readMobile('src/screens/EditScreen.tsx')).toContain('assetUri={');
  });

  it('draws them on the desktop', async () => {
    const canvas = await readDesktop('renderer/src/editor/TimelineCanvas.tsx');
    expect(canvas).toContain('<ClipFilmstrip');
    // Percent-wide clips need the lane's pixels before they can say how many
    // frames fit, so the width is measured rather than guessed.
    expect(canvas).toContain('laneWidthPx');
  });

  it('never lets a failed decode stop an edit', async () => {
    // Both caches swallow the failure and return nothing rather than throwing
    // into a render.
    expect(await readMobile('src/lib/thumbnails.ts')).toContain('return null;');
    expect(await readDesktop('renderer/src/editor/clipThumbnails.ts')).toContain('return [];');
  });
});
