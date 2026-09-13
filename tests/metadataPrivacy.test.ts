import { describe, expect, it } from 'vitest';

import { createEmptyAiProjectDocument } from '../src/shared/aiProjectDomain';
import { createDeliveryProvenance, timelineRevisionFingerprint } from '../src/shared/exportProvenance';
import {
  mergeMetadataTagInventories,
  metadataPrivacyPlan,
  metadataPrivacyVerificationSummary,
  PERSONAL_CONTAINER_METADATA_FIELDS,
  personalMetadataFieldsForKeys,
  verifyMetadataPrivacy
} from '../src/shared/metadataPrivacy';
import { DEFAULT_CLIP_EFFECTS, PROJECT_SCHEMA_VERSION, TIMELINE_SCHEMA_VERSION, type LocalProjectSnapshot } from '../src/shared/timelineTypes';

const project: LocalProjectSnapshot = {
  schemaVersion: PROJECT_SCHEMA_VERSION,
  id: 'project_01',
  name: 'Private project name',
  createdAt: '2026-09-10T00:00:00.000Z',
  updatedAt: '2026-09-10T01:00:00.000Z',
  assets: [{
    id: 'asset_01', displayName: 'C:\\Users\\Creator\\secret.mov', projectRelativePath: 'assets/asset_01/original.mov',
    kind: 'video', mimeType: 'video/quicktime', byteLength: 10, metadata: { durationMs: 1_000, width: 640, height: 360 },
    createdAt: '2026-09-10T00:00:00.000Z', updatedAt: '2026-09-10T00:00:00.000Z'
  }],
  timeline: {
    schemaVersion: TIMELINE_SCHEMA_VERSION,
    tracks: [{ kind: 'video', id: 'track_01', name: 'Video', clips: [{
      id: 'clip_01', assetId: 'asset_01', timelineStartMs: 0, sourceStartMs: 0, sourceEndMs: 1_000,
      sourceDurationMs: 1_000, effects: DEFAULT_CLIP_EFFECTS, keyframes: []
    }] }],
    transitions: []
  },
  ai: {
    ...createEmptyAiProjectDocument(),
    provenance: [{
      id: 'provenance_01', source: 'provider', createdAt: '2026-09-10T00:30:00.000Z',
      inputAssetIds: ['asset_01'], outputAssetIds: ['asset_01'],
      providerId: 'google_gemini', modelId: 'veo-3.1',
      transformHistory: ['Downloaded from C:\\Users\\Creator\\private with key AIza-secret'],
      rightsNote: 'Creator legal name and C:\\private\\contract.pdf'
    }, {
      id: 'provenance_unrelated', source: 'provider', createdAt: '2026-09-10T00:31:00.000Z',
      inputAssetIds: [], outputAssetIds: ['asset_unrelated'], providerId: 'private_provider',
      transformHistory: ['Unrelated experiment must not leave the project'], rightsNote: 'Unrelated rights'
    }]
  }
};

const locationField = PERSONAL_CONTAINER_METADATA_FIELDS.find((field) => field.key === 'location')!;
const verifiedClean = verifyMetadataPrivacy(
  'privacy_clean',
  { checked: true, fields: [locationField] },
  { checked: true, fields: [] }
);

describe('metadata privacy and delivery provenance', () => {
  it('uses a closed personal-field allowlist and never targets mandatory provenance classes', () => {
    const clean = metadataPrivacyPlan('privacy_clean');
    const preserve = metadataPrivacyPlan('preserve_provenance');
    expect(clean.removedFields).toBe(PERSONAL_CONTAINER_METADATA_FIELDS);
    expect(clean.removedFields.map((field) => field.key)).toContain('location');
    expect(clean.removedFields.map((field) => field.key)).not.toContain('copyright');
    expect(clean.untargetedSignals.join(' ')).toMatch(/C2PA.*SynthID/);
    expect(preserve.removedFields).toEqual([]);
  });

  it('fingerprints the exact timeline deterministically and changes when the cut changes', () => {
    const first = timelineRevisionFingerprint(project.timeline);
    const same = timelineRevisionFingerprint({ ...project.timeline });
    const changed = timelineRevisionFingerprint({ ...project.timeline, tracks: [] });
    expect(first).toBe(same);
    expect(changed).not.toBe(first);
  });

  it('normalizes only allowlisted names and compares actual before/after inventories', () => {
    const fields = personalMetadataFieldsForKeys(['AUTHOR', 'copyright', 'Com.Apple.QuickTime.Location.ISO6709', 'author']);
    expect(fields.map((field) => field.key)).toEqual(['com.apple.quicktime.location.ISO6709', 'author']);
    expect(mergeMetadataTagInventories([
      { checked: true, fields: [fields[1]!] },
      { checked: false, fields: [fields[0]!] }
    ])).toEqual({ checked: false, fields });
    expect(verifiedClean).toMatchObject({ checked: true, ok: true, beforeFields: [locationField], afterFields: [] });
    expect(metadataPrivacyVerificationSummary(verifiedClean)).toContain('after: none');
    expect(verifyMetadataPrivacy(
      'privacy_clean',
      { checked: true, fields: [locationField] },
      { checked: true, fields: [locationField] }
    )).toMatchObject({ checked: true, ok: false, afterFields: [locationField] });
    expect(verifyMetadataPrivacy(
      'privacy_clean',
      { checked: false, fields: [] },
      { checked: true, fields: [] }
    )).toMatchObject({ checked: false, why: expect.stringContaining('FFprobe') });
  });

  it('exports lineage without prompts, rights text, credentials, display names or local paths', () => {
    const provenance = createDeliveryProvenance({
      project,
      exportedAt: '2026-09-10T02:00:00.000Z', width: 640, height: 360, frameRate: 30, durationMs: 1_000,
      subtitleDelivery: { burnAutomaticCaptions: true, sidecarFormat: 'none' }, metadataPrivacyMode: 'privacy_clean',
      metadataPrivacyVerification: verifiedClean,
      output: { fileName: 'export_01.mp4', fileSizeBytes: 100, sha256: 'a'.repeat(64) }
    });
    const serialized = JSON.stringify(provenance);
    expect(provenance.projectRevision.timelineFingerprint).toMatch(/^fnv1a32:[0-9a-f]{8}$/);
    expect(provenance.lineage[0]).toMatchObject({ providerId: 'google_gemini', modelId: 'veo-3.1', rightsRecorded: true });
    expect(provenance.lineage).toHaveLength(1);
    expect(serialized).not.toMatch(/Private project name|Creator|secret|contract|AIza|C:\\|original\.mov/i);
    expect(serialized).not.toMatch(/private_provider|Unrelated/);
    expect(provenance.lineage[0]?.transformHistoryFingerprints[0]).toMatch(/^fnv1a32:/);
    expect(provenance.delivery.output.sha256).toHaveLength(64);
  });

  it('drops credential-shaped values even when corrupt project data placed them in public identifier fields', () => {
    const credentialProject: LocalProjectSnapshot = {
      ...project,
      ai: {
        ...project.ai,
        provenance: [{
          ...project.ai.provenance[0]!,
          providerId: 'AIzaSyDefinitelyNotAProvider',
          modelId: 'sk-proj-definitely-not-a-model'
        }]
      }
    };
    const provenance = createDeliveryProvenance({
      project: credentialProject,
      exportedAt: '2026-09-10T02:00:00.000Z', width: 640, height: 360, frameRate: 30, durationMs: 1_000,
      subtitleDelivery: { burnAutomaticCaptions: true, sidecarFormat: 'none' }, metadataPrivacyMode: 'preserve_provenance',
      metadataPrivacyVerification: verifyMetadataPrivacy(
        'preserve_provenance',
        { checked: true, fields: [] },
        { checked: true, fields: [] }
      ),
      output: { fileName: 'export_01.mp4', fileSizeBytes: 100, sha256: 'a'.repeat(64) }
    });
    expect(provenance.lineage[0]).not.toHaveProperty('providerId');
    expect(provenance.lineage[0]).not.toHaveProperty('modelId');
  });
});
