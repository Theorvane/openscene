import type { FramePreference } from '../../../shared/outputFrame';

/**
 * The shape a project is exported into, remembered per project.
 *
 * The phone has offered this since portrait footage stopped coming out
 * pillarboxed; the desktop asked for nothing and exported at whatever the first
 * video asset happened to be. Two problems in one: no way to say "make this
 * portrait", and a *different* answer from the phone for the same project —
 * the desktop looked at the assets, the shared rule looks at the timeline's
 * leading clip, and a project that opened with its second import silently
 * changed shape between the two.
 *
 * Per project, because the answer belongs to the cut rather than to the app: one
 * project is a widescreen piece and the next is for a phone.
 *
 * In `localStorage` rather than in the project record, which is where the
 * editor's other preferences live. A frame preference lost with the browser
 * profile costs one menu choice; a project file that fails to open because it
 * gained a field costs the project.
 */

export const EXPORT_FRAME_STORAGE_KEY = 'openscene.export.frame.v1';

export const EXPORT_FRAME_PREFERENCES: readonly FramePreference[] = ['source', 'portrait', 'landscape', 'square'];

/** The footage's own shape, which is what a cut of one clip should come out as. */
export const DEFAULT_EXPORT_FRAME: FramePreference = 'source';

export const EXPORT_FRAME_LABELS: Readonly<Record<FramePreference, string>> = {
  source: 'Source',
  portrait: 'Portrait',
  landscape: 'Landscape',
  square: 'Square'
};

function isFramePreference(value: unknown): value is FramePreference {
  return typeof value === 'string' && EXPORT_FRAME_PREFERENCES.includes(value as FramePreference);
}

/**
 * Anything unreadable is the default rather than a thrown error.
 *
 * A preference is not worth failing an editor over: the worst a bad entry can do
 * is export the shape the footage already is, which is what happens with no
 * preference at all.
 */
export function parseExportFramePreferences(raw: string | null): Readonly<Record<string, FramePreference>> {
  if (raw === null) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
    const entries = Object.entries(parsed as Record<string, unknown>).filter(
      (entry): entry is [string, FramePreference] => isFramePreference(entry[1])
    );
    return Object.fromEntries(entries);
  } catch {
    return {};
  }
}

export function serializeExportFramePreferences(preferences: Readonly<Record<string, FramePreference>>): string {
  // The default is not written down: it is what an absent entry means, and
  // storing it would grow the record by one line per project ever opened.
  const kept = Object.entries(preferences).filter(([, preference]) => preference !== DEFAULT_EXPORT_FRAME);
  return JSON.stringify(Object.fromEntries(kept));
}
