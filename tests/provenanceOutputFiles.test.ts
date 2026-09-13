import { createHash } from 'node:crypto';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { hashExportOutput, writeExportProvenanceSidecar } from '../src/main/exportOutputFiles';
import type { DeliveryProvenance } from '../src/shared/exportProvenance';

const provenance: DeliveryProvenance = {
  schemaVersion: 2,
  projectRevision: {
    projectId: 'project_01', projectUpdatedAt: '2026-09-10T00:00:00.000Z', projectSchemaVersion: 4,
    timelineSchemaVersion: 3, aiSchemaVersion: 1, timelineFingerprint: 'fnv1a32:12345678'
  },
  delivery: {
    exportedAt: '2026-09-10T01:00:00.000Z', width: 1920, height: 1080, frameRate: 30, durationMs: 1_000,
    subtitleDelivery: { burnAutomaticCaptions: true, sidecarFormat: 'none' },
    metadataPrivacyMode: 'privacy_clean', requestedContainerMetadataKeys: ['location'],
    metadataPrivacyVerification: {
      mode: 'privacy_clean', checked: true, ok: true,
      beforeFields: [{ key: 'location', label: 'GPS/location', category: 'location' }], afterFields: []
    },
    untargetedSignalClasses: ['Content Credentials/C2PA'],
    output: { fileName: 'export_01.mp4', fileSizeBytes: 4, sha256: 'a'.repeat(64) }
  },
  lineage: []
};

describe('provenance output containment', () => {
  it('streams an MP4 checksum and writes create-new path-free JSON beside it', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'provenance-output-'));
    try {
      const mp4 = join(parent, 'export_01.mp4');
      await writeFile(mp4, 'mp4!');
      const checksum = await hashExportOutput(mp4);
      expect(checksum).toEqual({
        sha256: createHash('sha256').update('mp4!').digest('hex'),
        fileSizeBytes: 4
      });
      const written = await writeExportProvenanceSidecar(parent, 'export_01', provenance);
      expect(written.fileName).toBe('export_01.provenance.json');
      expect(JSON.parse(await readFile(written.outputPath, 'utf8'))).toEqual(provenance);
      await expect(writeExportProvenanceSidecar(parent, 'export_01', provenance)).rejects.toThrow();
      await expect(writeExportProvenanceSidecar(parent, '../escape', provenance)).rejects.toThrow('not safe');
      await expect(access(join(parent, '..', 'escape.provenance.json'))).rejects.toThrow();
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });
});
