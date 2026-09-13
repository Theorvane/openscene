import type { TimelineDocument, TimelineTitle, TimelineTitleStyle } from './timelineTypes';
import { hasAllowedKeys, isPlainRecord } from './timelineValidationPrimitives';

export const CAPTION_PLACEMENTS = ['free', 'top', 'center', 'bottom'] as const;
export const CAPTION_FONT_WEIGHTS = ['regular', 'bold'] as const;
export type CaptionPresetId = 'clean' | 'boxed' | 'cinema' | 'social';

export const TITLE_STYLE_LIMITS = {
  outlineWidthPx: { min: 0, max: 24 },
  backgroundOpacity: { min: 0, max: 1 },
  paddingPx: { min: 0, max: 64 }
} as const;

/** What every project written before Caption Studio means. */
export const LEGACY_TITLE_STYLE: TimelineTitleStyle = Object.freeze({
  fontWeight: 'regular',
  outlineColor: '#000000',
  outlineWidthPx: 0,
  backgroundColor: '#000000',
  backgroundOpacity: 0,
  paddingPx: 0,
  placement: 'free'
});

export type CaptionStylePreset = {
  readonly id: CaptionPresetId;
  readonly label: string;
  readonly description: string;
  readonly sizePx: number;
  readonly color: string;
  readonly style: TimelineTitleStyle;
};

export const DEFAULT_CAPTION_PRESET_ID: CaptionPresetId = 'clean';

/** Small, renderer-safe presets. They contain values, not provider-specific CSS. */
export const CAPTION_STYLE_PRESETS: readonly CaptionStylePreset[] = [
  {
    id: 'clean', label: 'Clean outline', description: 'Bold white text with a restrained black outline.', sizePx: 64, color: '#ffffff',
    style: { fontWeight: 'bold', outlineColor: '#000000', outlineWidthPx: 4, backgroundColor: '#000000', backgroundOpacity: 0, paddingPx: 8, placement: 'bottom' }
  },
  {
    id: 'boxed', label: 'Readable box', description: 'High-contrast caption on a translucent black box.', sizePx: 60, color: '#ffffff',
    style: { fontWeight: 'bold', outlineColor: '#000000', outlineWidthPx: 0, backgroundColor: '#000000', backgroundOpacity: 0.72, paddingPx: 16, placement: 'bottom' }
  },
  {
    id: 'cinema', label: 'Cinema', description: 'Warm, restrained text for narrative and documentary cuts.', sizePx: 58, color: '#f7e8c6',
    style: { fontWeight: 'regular', outlineColor: '#000000', outlineWidthPx: 3, backgroundColor: '#000000', backgroundOpacity: 0, paddingPx: 8, placement: 'bottom' }
  },
  {
    id: 'social', label: 'Social punch', description: 'Large yellow type designed for fast vertical content.', sizePx: 76, color: '#ffe14a',
    style: { fontWeight: 'bold', outlineColor: '#000000', outlineWidthPx: 6, backgroundColor: '#000000', backgroundOpacity: 0, paddingPx: 10, placement: 'center' }
  }
];

export function isAutomaticCaptionId(id: string): boolean {
  return id.startsWith('auto-caption-') || id.startsWith('transcript-caption-');
}

function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value);
}

export function parseTimelineTitleStyle(value: unknown): TimelineTitleStyle | null {
  if (!isPlainRecord(value) || !hasAllowedKeys(value, [
    'fontWeight', 'outlineColor', 'outlineWidthPx', 'backgroundColor', 'backgroundOpacity', 'paddingPx', 'placement'
  ])) return null;
  if (!(CAPTION_FONT_WEIGHTS as readonly unknown[]).includes(value.fontWeight) ||
    !(CAPTION_PLACEMENTS as readonly unknown[]).includes(value.placement) ||
    !isHexColor(value.outlineColor) || !isHexColor(value.backgroundColor) ||
    typeof value.outlineWidthPx !== 'number' || !Number.isFinite(value.outlineWidthPx) ||
    value.outlineWidthPx < TITLE_STYLE_LIMITS.outlineWidthPx.min || value.outlineWidthPx > TITLE_STYLE_LIMITS.outlineWidthPx.max ||
    typeof value.backgroundOpacity !== 'number' || !Number.isFinite(value.backgroundOpacity) ||
    value.backgroundOpacity < TITLE_STYLE_LIMITS.backgroundOpacity.min || value.backgroundOpacity > TITLE_STYLE_LIMITS.backgroundOpacity.max ||
    typeof value.paddingPx !== 'number' || !Number.isFinite(value.paddingPx) ||
    value.paddingPx < TITLE_STYLE_LIMITS.paddingPx.min || value.paddingPx > TITLE_STYLE_LIMITS.paddingPx.max) return null;
  return {
    fontWeight: value.fontWeight as TimelineTitleStyle['fontWeight'],
    outlineColor: value.outlineColor,
    outlineWidthPx: value.outlineWidthPx,
    backgroundColor: value.backgroundColor,
    backgroundOpacity: value.backgroundOpacity,
    paddingPx: value.paddingPx,
    placement: value.placement as TimelineTitleStyle['placement']
  };
}

export function resolvedTitleStyle(title: TimelineTitle): TimelineTitleStyle {
  return title.style ?? LEGACY_TITLE_STYLE;
}

export function captionPreset(id: CaptionPresetId): CaptionStylePreset {
  const preset = CAPTION_STYLE_PRESETS.find((candidate) => candidate.id === id);
  if (preset === undefined) throw new Error('Unknown caption style preset.');
  return preset;
}

/** Presets never alter identity, text or timing. */
export function applyCaptionPreset(title: TimelineTitle, presetId: CaptionPresetId): TimelineTitle & { readonly style: TimelineTitleStyle } {
  const preset = captionPreset(presetId);
  return {
    ...title,
    sizePx: preset.sizePx,
    color: preset.color,
    positionX: 0,
    positionY: 0,
    style: { ...preset.style }
  };
}

export function copyTitleAppearance(title: TimelineTitle, source: TimelineTitle): TimelineTitle {
  const next = {
    ...title,
    sizePx: source.sizePx,
    color: source.color,
    positionX: source.positionX,
    positionY: source.positionY,
    ...(source.style === undefined ? {} : { style: { ...source.style } })
  };
  if (source.style !== undefined) return next;
  const { style: _removed, ...legacy } = next;
  return legacy;
}

/** Copies appearance only, leaving every caption's words and timing untouched. */
export function applyTitleAppearanceToAutomaticCaptions(timeline: TimelineDocument, sourceTitleId: string): TimelineDocument | null {
  const source = (timeline.titles ?? []).find((title) => title.id === sourceTitleId);
  if (source === undefined) return null;
  let changed = false;
  const titles = (timeline.titles ?? []).map((title) => {
    if (!isAutomaticCaptionId(title.id)) return title;
    changed = true;
    return copyTitleAppearance(title, source);
  });
  return changed ? { ...timeline, titles } : null;
}

/** Output-frame centre offset, with title-safe anchors resolved per aspect ratio. */
export function titleOutputPosition(
  title: TimelineTitle,
  frame: { readonly width: number; readonly height: number }
): { readonly x: number; readonly y: number } {
  const placement = resolvedTitleStyle(title).placement;
  const anchorY = placement === 'top'
    ? -frame.height * 0.32
    : placement === 'bottom'
      ? frame.height * 0.32
      : 0;
  return { x: title.positionX, y: title.positionY + anchorY };
}
