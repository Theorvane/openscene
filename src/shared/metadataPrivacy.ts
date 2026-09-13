export const METADATA_PRIVACY_MODES = ['preserve_provenance', 'privacy_clean'] as const;

export type MetadataPrivacyMode = (typeof METADATA_PRIVACY_MODES)[number];

export const DEFAULT_METADATA_PRIVACY_MODE: MetadataPrivacyMode = 'preserve_provenance';

export type PersonalContainerMetadataField = {
  readonly key: string;
  readonly label: string;
  readonly category: 'location' | 'identity' | 'device' | 'comment' | 'date';
};

/**
 * Container tags Privacy Clean may blank on the newly rendered delivery file.
 *
 * This is deliberately an allowlist. Copyright, Content Credentials/C2PA,
 * provider labels and unknown tags never enter the removal request.
 */
export const PERSONAL_CONTAINER_METADATA_FIELDS: readonly PersonalContainerMetadataField[] = Object.freeze([
  { key: 'location', label: 'GPS/location', category: 'location' },
  { key: 'location-eng', label: 'English GPS/location', category: 'location' },
  { key: 'com.apple.quicktime.location.ISO6709', label: 'QuickTime GPS/location', category: 'location' },
  { key: 'author', label: 'Author name', category: 'identity' },
  { key: 'artist', label: 'Artist/owner name', category: 'identity' },
  { key: 'album_artist', label: 'Album artist name', category: 'identity' },
  { key: 'composer', label: 'Composer name', category: 'identity' },
  { key: 'performer', label: 'Performer name', category: 'identity' },
  { key: 'publisher', label: 'Publisher name', category: 'identity' },
  { key: 'encoded_by', label: 'Encoder operator', category: 'identity' },
  { key: 'make', label: 'Device manufacturer', category: 'device' },
  { key: 'model', label: 'Device model', category: 'device' },
  { key: 'device', label: 'Device name', category: 'device' },
  { key: 'device_model', label: 'Device model name', category: 'device' },
  { key: 'software', label: 'Source software name', category: 'device' },
  { key: 'comment', label: 'Comment', category: 'comment' },
  { key: 'description', label: 'Description', category: 'comment' },
  { key: 'synopsis', label: 'Synopsis', category: 'comment' },
  { key: 'title', label: 'Embedded title', category: 'comment' },
  { key: 'creation_time', label: 'Creation timestamp', category: 'date' },
  { key: 'date', label: 'Recorded date', category: 'date' }
]);

export const UNTARGETED_PROVENANCE_SIGNAL_CLASSES = Object.freeze([
  'Copyright and rights declarations',
  'Content Credentials/C2PA',
  'SynthID and provider safety markings',
  'Provider-required AI labels',
  'Visible watermarks and marks inside the picture or sound',
  'Unknown metadata outside the personal-field allowlist'
] as const);

export type MetadataPrivacyPlan = {
  readonly mode: MetadataPrivacyMode;
  readonly label: string;
  readonly summary: string;
  readonly removedFields: readonly PersonalContainerMetadataField[];
  /** Classes this feature never asks FFmpeg to remove; this is not a claim that re-encoding can preserve every format. */
  readonly untargetedSignals: readonly string[];
};

export type MetadataTagInventory = {
  /** False means FFprobe could not return a complete inventory. */
  readonly checked: boolean;
  /** Allowlisted field definitions only; raw tag values never enter this contract. */
  readonly fields: readonly PersonalContainerMetadataField[];
};

export type MetadataPrivacyVerification =
  | {
      readonly mode: MetadataPrivacyMode;
      readonly checked: false;
      readonly beforeFields: readonly PersonalContainerMetadataField[];
      readonly afterFields: readonly PersonalContainerMetadataField[];
      readonly why: string;
    }
  | {
      readonly mode: MetadataPrivacyMode;
      readonly checked: true;
      readonly ok: boolean;
      readonly beforeFields: readonly PersonalContainerMetadataField[];
      readonly afterFields: readonly PersonalContainerMetadataField[];
    };

/** Reduces arbitrary probe keys to the closed, stable field catalog. */
export function personalMetadataFieldsForKeys(keys: readonly string[]): readonly PersonalContainerMetadataField[] {
  const found = new Set(keys.map((key) => key.toLowerCase()));
  return PERSONAL_CONTAINER_METADATA_FIELDS.filter((field) => found.has(field.key.toLowerCase()));
}

export function mergeMetadataTagInventories(inventories: readonly MetadataTagInventory[]): MetadataTagInventory {
  return {
    checked: inventories.every((inventory) => inventory.checked),
    fields: personalMetadataFieldsForKeys(inventories.flatMap((inventory) => inventory.fields.map((field) => field.key)))
  };
}

export function verifyMetadataPrivacy(
  mode: MetadataPrivacyMode,
  before: MetadataTagInventory,
  after: MetadataTagInventory
): MetadataPrivacyVerification {
  if (!before.checked || !after.checked) {
    return {
      mode,
      checked: false,
      beforeFields: before.fields,
      afterFields: after.fields,
      why: 'The before/after container metadata inventory could not be completed with FFprobe.'
    };
  }
  return {
    mode,
    checked: true,
    ok: mode === 'preserve_provenance' || after.fields.length === 0,
    beforeFields: before.fields,
    afterFields: after.fields
  };
}

export function metadataPrivacyVerificationSummary(verification: MetadataPrivacyVerification): string {
  if (!verification.checked) return verification.why;
  const before = verification.beforeFields.length === 0
    ? 'none'
    : verification.beforeFields.map((field) => field.label).join(', ');
  const after = verification.afterFields.length === 0
    ? 'none'
    : verification.afterFields.map((field) => field.label).join(', ');
  if (verification.mode === 'preserve_provenance') {
    return `Observed allowlisted personal tags — before: ${before}; after: ${after}. No removal was requested.`;
  }
  return verification.ok
    ? `Privacy Clean verified — before: ${before}; after: none.`
    : `Privacy Clean did not pass — before: ${before}; remaining after export: ${after}.`;
}

export function parseMetadataPrivacyMode(value: unknown): MetadataPrivacyMode | null {
  return typeof value === 'string' && (METADATA_PRIVACY_MODES as readonly string[]).includes(value)
    ? value as MetadataPrivacyMode
    : null;
}

export function metadataPrivacyPlan(mode: MetadataPrivacyMode): MetadataPrivacyPlan {
  return mode === 'privacy_clean'
    ? {
        mode,
        label: 'Privacy Clean',
        summary: 'Blank allowlisted personal container fields on the new MP4 and verify the result with FFprobe. Source assets remain unchanged.',
        removedFields: PERSONAL_CONTAINER_METADATA_FIELDS,
        untargetedSignals: UNTARGETED_PROVENANCE_SIGNAL_CLASSES
      }
    : {
        mode,
        label: 'Preserve Provenance',
        summary: 'Do not request removal of container metadata. A path-free provenance sidecar is still created.',
        removedFields: [],
        untargetedSignals: UNTARGETED_PROVENANCE_SIGNAL_CLASSES
      };
}

/** Output-only FFmpeg options; absent in Preserve Provenance mode. */
export function ffmpegMetadataPrivacyArgs(mode: MetadataPrivacyMode): readonly string[] {
  if (mode !== 'privacy_clean') return [];
  return PERSONAL_CONTAINER_METADATA_FIELDS.flatMap((field) => [
    '-metadata', `${field.key}=`,
    '-metadata:s', `${field.key}=`
  ]);
}
