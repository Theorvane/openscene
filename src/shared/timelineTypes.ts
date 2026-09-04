import type { AiProjectDocument } from './aiProjectDomain';

/**
 * `image` is a still. It has no timeline of its own and is held rather than
 * played; see `timelineStills` for what that means to a renderer. Tracks are
 * still only video and audio — a still is picture and composites with the rest
 * of the picture, so it lives on a video track.
 */
export const MEDIA_KINDS = ['video', 'audio', 'image'] as const;
export const TIMELINE_SCHEMA_VERSION = 3 as const;
export const PROJECT_SCHEMA_VERSION = 4 as const;
export const CLIP_EFFECT_PROPERTIES = ['opacity', 'scale', 'positionX', 'positionY', 'rotation', 'volume'] as const;
export const KEYFRAME_INTERPOLATIONS = ['linear'] as const;
export const TRANSITION_TYPES = ['fade', 'crossfade', 'dipToBlack'] as const;

export const CLIP_EFFECT_RANGES = {
  opacity: { min: 0, max: 1 },
  scale: { min: 0, max: 2 },
  positionX: { min: -10_000, max: 10_000 },
  positionY: { min: -10_000, max: 10_000 },
  rotation: { min: 0, max: 360 },
  volume: { min: 0, max: 1 },
  // Slower than a quarter is a slideshow of held frames, and faster than four
  // is a source read faster than it can be decoded on a phone.
  speed: { min: 0.25, max: 4 },
  // Added, so 0 is neutral and the ends are a stop either way.
  brightness: { min: -1, max: 1 },
  // Multiplied, so 1 is neutral. Zero contrast is a flat grey card and zero
  // saturation is black and white, which is a filter rather than a mistake.
  contrast: { min: 0, max: 2 },
  saturation: { min: 0, max: 2 },
  volumeDb: { min: -40, max: 0 }
} as const;

export const AUDIO_TRACK_MIX_RANGES = {
  gainDb: { min: -60, max: 12 },
  pan: { min: -1, max: 1 }
} as const;

export type ClipEffects = {
  readonly opacity: number;
  readonly scale: number;
  readonly positionX: number;
  readonly positionY: number;
  readonly rotation: number;
  readonly volume: number;
  /**
   * Playback rate. 2 is twice as fast and half as long on the timeline.
   *
   * Optional, because every project written before speed existed has no such
   * key and must still open unchanged. Absent means 1 everywhere, and
   * `clipSpeed` is the only place that decides that.
   *
   * Unlike every other effect this one changes how much room the clip takes,
   * which is why the timeline length and the source window are now two separate
   * questions rather than the same subtraction.
   */
  readonly speed?: number;
  /**
   * Colour, as three numbers that mean what every grading control means.
   *
   * `brightness` is added, `contrast` and `saturation` are multiplied, and all
   * three are optional: absent is neutral, so a project written before colour
   * existed opens and saves back byte-identical. Neutral also renders
   * identically on all three renderers, which is what lets one of them not have
   * the feature yet without changing anybody's export.
   */
  readonly brightness?: number;
  readonly contrast?: number;
  readonly saturation?: number;
};

export const DEFAULT_CLIP_EFFECTS: ClipEffects = Object.freeze({
  opacity: 1,
  scale: 1,
  positionX: 0,
  positionY: 0,
  rotation: 0,
  volume: 1
  // No `speed`. Absent is 1, and leaving the key off keeps every document
  // written before speed existed byte-identical when it is opened and saved.
});

export type ClipEffectProperty = (typeof CLIP_EFFECT_PROPERTIES)[number];
export type KeyframeInterpolation = (typeof KEYFRAME_INTERPOLATIONS)[number];
export type TransitionType = (typeof TRANSITION_TYPES)[number];

export type ClipKeyframe = {
  readonly timelineTimeMs: number;
  readonly property: ClipEffectProperty;
  readonly value: number;
  readonly interpolation: KeyframeInterpolation;
};

export type TransitionDescriptor = {
  readonly fromClipId: string;
  readonly toClipId: string;
  readonly type: TransitionType;
  readonly durationMs: number;
};

export type AudioTrackMix = {
  readonly gainDb: number;
  readonly pan: number;
  readonly muted: boolean;
};

export const DEFAULT_AUDIO_TRACK_MIX: AudioTrackMix = Object.freeze({
  gainDb: 0,
  pan: 0,
  muted: false
});

export type MediaKind = (typeof MEDIA_KINDS)[number];

export type BrowserAssetMetadata = {
  readonly durationMs: number;
  readonly width?: number;
  readonly height?: number;
};

export type MediaAsset = {
  readonly id: string;
  readonly displayName: string;
  readonly projectRelativePath: string;
  readonly kind: MediaKind;
  readonly mimeType: string;
  readonly byteLength: number;
  readonly metadata: BrowserAssetMetadata | null;
  readonly createdAt: string;
  readonly updatedAt: string;
};

export type TimelineClip = {
  readonly id: string;
  readonly assetId: string;
  readonly timelineStartMs: number;
  readonly sourceStartMs: number;
  readonly sourceEndMs: number;
  readonly sourceDurationMs: number;
  readonly effects?: ClipEffects;
  readonly keyframes?: readonly ClipKeyframe[];
};

export type PersistedTimelineClip = TimelineClip & {
  readonly effects: ClipEffects;
  readonly keyframes: readonly ClipKeyframe[];
};

type TimelineTrackBase = {
  readonly id: string;
  readonly name: string;
  readonly clips: readonly PersistedTimelineClip[];
};

export type VideoTimelineTrack = TimelineTrackBase & {
  readonly kind: 'video';
};

export type AudioTimelineTrack = TimelineTrackBase & {
  readonly kind: 'audio';
  readonly mix: AudioTrackMix;
};

export type TimelineTrack = VideoTimelineTrack | AudioTimelineTrack;

/**
 * Words on the picture.
 *
 * A title is not an asset — there is no file to import — so it does not fit the
 * clip model, which is a range of a source. It belongs to the document: what it
 * says, when it says it, and where.
 *
 * The geometry is in output-frame pixels rather than fractions, matching
 * `ClipEffects.positionX/Y`, so a title placed against a 1920-wide render means
 * the same distance to every renderer. `positionX/Y` are offsets from the centre
 * of the frame, which is where a title sits when nobody has moved it.
 */
export type TimelineTitle = {
  readonly id: string;
  readonly text: string;
  readonly timelineStartMs: number;
  readonly timelineEndMs: number;
  /** Cap height in output-frame pixels. */
  readonly sizePx: number;
  /** `#rrggbb`. Validators refuse anything else, because every renderer parses it differently. */
  readonly color: string;
  readonly positionX: number;
  readonly positionY: number;
};

export const DEFAULT_TITLE: Omit<TimelineTitle, 'id' | 'timelineStartMs' | 'timelineEndMs'> = {
  text: 'Title',
  sizePx: 72,
  color: '#ffffff',
  positionX: 0,
  positionY: 0
};

export type TimelineDocument = {
  readonly schemaVersion: typeof TIMELINE_SCHEMA_VERSION;
  readonly tracks: readonly TimelineTrack[];
  readonly transitions: readonly TransitionDescriptor[];
  /**
   * Optional, because every project written before titles existed has none and
   * must still open. Absent and empty mean the same thing.
   */
  readonly titles?: readonly TimelineTitle[];
};

export type LocalProjectSnapshot = {
  readonly schemaVersion: typeof PROJECT_SCHEMA_VERSION;
  readonly id: string;
  readonly name: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly assets: readonly MediaAsset[];
  readonly timeline: TimelineDocument;
  /** Script, storyboard and generation lineage stored beside the authoritative timeline. */
  readonly ai: AiProjectDocument;
};

/** Folder-picker backed results: the user can cancel the native dialog. */
export type CreateProjectResult =
  | { readonly cancelled: true }
  | { readonly cancelled: false; readonly project: LocalProjectSnapshot };

export type OpenProjectFolderResult =
  | { readonly cancelled: true }
  | { readonly cancelled: false; readonly created: boolean; readonly project: LocalProjectSnapshot };

export type LocalProjectSummary = {
  readonly id: string;
  readonly name: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  /** Where the project lives: the private internal store or a user-chosen real folder. */
  readonly storage?: 'internal' | 'external';
  /** Folder name (never the full path) for externally stored projects. */
  readonly folderName?: string;
};

export type PlaceClipInput = {
  readonly trackId: string;
  readonly clip: TimelineClip;
};

export type MoveClipInput = {
  readonly clipId: string;
  readonly targetTrackId: string;
  readonly timelineStartMs: number;
};

export type TrimClipLeftInput = {
  readonly clipId: string;
  readonly timelineStartMs: number;
};

export type TrimClipRightInput = {
  readonly clipId: string;
  readonly timelineEndMs: number;
};

export type SplitClipInput = {
  readonly clipId: string;
  readonly atMs: number;
  readonly rightClipId: string;
};

export type UpdateClipEffectsInput = {
  readonly clipId: string;
  readonly effects: Partial<ClipEffects>;
};

export type AddClipKeyframeInput = {
  readonly clipId: string;
  readonly keyframe: ClipKeyframe;
};

export type RemoveClipKeyframeInput = {
  readonly clipId: string;
  readonly property: ClipEffectProperty;
  readonly timelineTimeMs: number;
};

export type UpdateClipKeyframeInput = RemoveClipKeyframeInput & {
  readonly keyframe: ClipKeyframe;
};

export type RemoveTransitionInput = {
  readonly fromClipId: string;
  readonly toClipId: string;
};

export type UpdateAudioTrackMixInput = {
  readonly trackId: string;
  readonly mix: Partial<AudioTrackMix>;
};

export type AddTrackInput = {
  readonly id: string;
  readonly name: string;
  readonly kind: MediaKind;
};

export type CreateProjectInput = {
  readonly name: string;
};

export type ListProjectsInput = Readonly<Record<string, never>>;

type ProjectRequestInput = {
  readonly projectId: string;
};

export type OpenProjectInput = ProjectRequestInput;
export type DeleteProjectInput = ProjectRequestInput;

export type ImportProjectAssetsInput = ProjectRequestInput & {
  readonly acceptedKinds?: readonly MediaKind[];
};

export type ImportRecordingResultAssetInput = ProjectRequestInput & {
  readonly sessionId: string;
};

export type ImportTtsResultAssetInput = ProjectRequestInput & {
  readonly jobId: string;
};

export type ImportMediaInput = ProjectRequestInput & {
  readonly displayName: string;
  readonly projectRelativePath: string;
  readonly kind: MediaKind;
  readonly mimeType: string;
  readonly byteLength: number;
};

export type UpdateAssetMetadataInput = ProjectRequestInput & {
  readonly assetId: string;
  readonly durationMs: number;
  readonly width?: number;
  readonly height?: number;
};

export type SaveTimelineInput = ProjectRequestInput & {
  readonly timeline: TimelineDocument;
};

export type GetAssetPlaybackUrlInput = ProjectRequestInput & {
  readonly assetId: string;
};

export type ImportProjectAssetsResult = {
  readonly assets: readonly MediaAsset[];
};
