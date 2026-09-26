import type { MediaKind } from './timelineTypes';

export const MEDIA_LIBRARY_SORTS = ['project', 'name', 'type', 'duration'] as const;
export type MediaLibrarySort = (typeof MEDIA_LIBRARY_SORTS)[number];

export type MediaLibraryFilters = {
  readonly query: string;
  readonly sort: MediaLibrarySort;
  readonly unusedOnly: boolean;
};

export const DEFAULT_MEDIA_LIBRARY_FILTERS: MediaLibraryFilters = Object.freeze({ query: '', sort: 'project', unusedOnly: false });

export function mediaLibraryFiltersActive(filters: MediaLibraryFilters): boolean {
  return filters.query.trim().length > 0 || filters.sort !== 'project' || filters.unusedOnly;
}

type LibraryAsset = {
  readonly id: string;
  readonly displayName: string;
  readonly kind: MediaKind;
};

type MediaLibraryViewOptions<T extends LibraryAsset> = {
  readonly query: string;
  readonly sort: MediaLibrarySort;
  readonly kind?: MediaKind;
  readonly durationMs: (asset: T) => number | null;
  readonly usage: ReadonlyMap<string, number>;
  readonly unusedOnly?: boolean;
};

/** Count every timeline clip reference, including repeated placements of one asset. */
export function countTimelineAssetUsage(timeline: { readonly tracks: readonly { readonly clips: readonly { readonly assetId: string }[] }[] }): ReadonlyMap<string, number> {
  const usage = new Map<string, number>();
  for (const track of timeline.tracks) {
    for (const clip of track.clips) usage.set(clip.assetId, (usage.get(clip.assetId) ?? 0) + 1);
  }
  return usage;
}

/** One library view rule for desktop and mobile; never changes the stored order. */
export function mediaLibraryView<T extends LibraryAsset>(assets: readonly T[], options: MediaLibraryViewOptions<T>): readonly T[] {
  const query = options.query.trim().toLowerCase();
  const matches = assets.filter((asset) =>
    (options.kind === undefined || asset.kind === options.kind)
    && (!options.unusedOnly || (options.usage.get(asset.id) ?? 0) === 0)
    && asset.displayName.toLowerCase().includes(query)
  );
  if (options.sort === 'project') return matches;

  return matches.map((asset, index) => ({ asset, index })).sort((left, right) => {
    let order = 0;
    if (options.sort === 'duration') {
      const leftDuration = options.durationMs(left.asset);
      const rightDuration = options.durationMs(right.asset);
      // Unread metadata belongs after known durations, regardless of length.
      if (leftDuration === null) order = rightDuration === null ? 0 : 1;
      else if (rightDuration === null) order = -1;
      else order = rightDuration - leftDuration;
    } else {
      const leftValue = (options.sort === 'name' ? left.asset.displayName : left.asset.kind).toLowerCase();
      const rightValue = (options.sort === 'name' ? right.asset.displayName : right.asset.kind).toLowerCase();
      order = leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0;
    }
    return order || left.index - right.index;
  }).map(({ asset }) => asset);
}
