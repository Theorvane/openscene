import { DEFAULT_TITLE, type TimelineDocument, type TimelineTitle } from './timelineTypes';

/**
 * Adding, editing and removing the words on a cut.
 *
 * Pure, and shared, for the reason every other editing rule is: a title placed
 * on a phone and reopened on a desktop has to be the same title, and the two
 * surfaces must not each invent what "add a title" means.
 */

/** Long enough to read, short enough not to sit over the whole cut. */
export const DEFAULT_TITLE_LENGTH_MS = 3_000;

export function addTitle(
  timeline: TimelineDocument,
  input: { readonly id: string; readonly atMs: number; readonly text?: string }
): TimelineDocument {
  const startMs = Math.max(0, Math.round(input.atMs));
  const title: TimelineTitle = {
    ...DEFAULT_TITLE,
    id: input.id,
    text: input.text ?? DEFAULT_TITLE.text,
    timelineStartMs: startMs,
    timelineEndMs: startMs + DEFAULT_TITLE_LENGTH_MS
  };
  return { ...timeline, titles: [...(timeline.titles ?? []), title] };
}

/**
 * Changes to one title, rejected rather than clamped when they make no sense.
 *
 * `null` is the same answer the clip rules give: the caller keeps the timeline
 * it had and says why, instead of silently getting something it did not ask for.
 */
export function updateTitle(
  timeline: TimelineDocument,
  id: string,
  changes: Partial<Omit<TimelineTitle, 'id'>>
): TimelineDocument | null {
  const titles = timeline.titles ?? [];
  const index = titles.findIndex((title) => title.id === id);
  if (index === -1) return null;

  const next = { ...(titles[index] as TimelineTitle), ...changes };
  if (next.timelineStartMs < 0) return null;
  // A title with no length is not a title; it is a value nothing can draw.
  if (next.timelineEndMs <= next.timelineStartMs) return null;
  if (next.sizePx <= 0) return null;
  if (!/^#[0-9a-fA-F]{6}$/.test(next.color)) return null;

  return { ...timeline, titles: titles.map((title, at) => (at === index ? next : title)) };
}

export function removeTitle(timeline: TimelineDocument, id: string): TimelineDocument | null {
  const titles = timeline.titles ?? [];
  if (!titles.some((title) => title.id === id)) return null;
  return { ...timeline, titles: titles.filter((title) => title.id !== id) };
}

/** Which title the playhead is inside, if any — the one an editor should be editing. */
export function titleAt(timeline: TimelineDocument, playheadMs: number): TimelineTitle | null {
  return (
    (timeline.titles ?? []).find(
      (title) => playheadMs >= title.timelineStartMs && playheadMs < title.timelineEndMs
    ) ?? null
  );
}
