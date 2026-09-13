import { hasAllowedKeys, isPlainRecord } from './timelineValidationPrimitives';

export const VIDEO_CONTINUITY_CONTROL_KEYS = [
  'characterConsistency',
  'styleConsistency',
  'sceneConsistency',
  'motionContinuity'
] as const;

export type VideoContinuityControlKey = (typeof VIDEO_CONTINUITY_CONTROL_KEYS)[number];

export type VideoContinuityControls = Readonly<Record<VideoContinuityControlKey, boolean>>;

export const DEFAULT_VIDEO_CONTINUITY_CONTROLS: VideoContinuityControls = {
  characterConsistency: true,
  styleConsistency: true,
  sceneConsistency: true,
  motionContinuity: false
};

export const VIDEO_CONTINUITY_PREFERENCES_STORAGE_PREFIX = 'openscene.video-continuity-controls.v1';

export function videoContinuityPreferencesStorageKey(projectId?: string | null): string {
  const scope = projectId?.trim() || 'no-project';
  return `${VIDEO_CONTINUITY_PREFERENCES_STORAGE_PREFIX}:${scope}`;
}

export function parseVideoContinuityControls(value: unknown): VideoContinuityControls | null {
  if (!isPlainRecord(value) || !hasAllowedKeys(value, VIDEO_CONTINUITY_CONTROL_KEYS)) return null;
  if (VIDEO_CONTINUITY_CONTROL_KEYS.some((key) => typeof value[key] !== 'boolean')) return null;
  return Object.fromEntries(VIDEO_CONTINUITY_CONTROL_KEYS.map((key) => [key, value[key]])) as VideoContinuityControls;
}

export function parseVideoContinuityPreferences(serialized: string | null): VideoContinuityControls {
  if (serialized === null) return DEFAULT_VIDEO_CONTINUITY_CONTROLS;
  try {
    return parseVideoContinuityControls(JSON.parse(serialized)) ?? DEFAULT_VIDEO_CONTINUITY_CONTROLS;
  } catch {
    return DEFAULT_VIDEO_CONTINUITY_CONTROLS;
  }
}
