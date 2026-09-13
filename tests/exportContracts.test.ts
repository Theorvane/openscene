import { describe, expect, it } from 'vitest';

import { IPC_CHANNELS } from '../src/shared/ipc';
import { parseExportJobActionInput, parseStartExportJobInput } from '../src/shared/exportValidators';

describe('export contracts', () => {
  it('parses a bounded MP4 export request and applies no filesystem path input', () => {
    expect(parseStartExportJobInput({ projectId: 'project_01', width: 1280, height: 720, frameRate: 30 })).toEqual({
      projectId: 'project_01',
      width: 1280,
      height: 720,
      frameRate: 30
    });
    expect(parseStartExportJobInput({ projectId: 'project_01' })).toEqual({ projectId: 'project_01' });
    expect(parseStartExportJobInput({ projectId: 'project_01', metadataPrivacyMode: 'privacy_clean' })).toEqual({
      projectId: 'project_01', metadataPrivacyMode: 'privacy_clean'
    });
    expect(parseStartExportJobInput({ projectId: 'project_01', metadataPrivacyMode: 'remove_everything' })).toBeNull();
    expect(parseStartExportJobInput({
      projectId: 'project_01',
      subtitleDelivery: { burnAutomaticCaptions: false, sidecarFormat: 'vtt' }
    })).toEqual({ projectId: 'project_01', subtitleDelivery: { burnAutomaticCaptions: false, sidecarFormat: 'vtt' } });
    expect(parseStartExportJobInput({ projectId: 'project_01', subtitleDelivery: { burnAutomaticCaptions: true, sidecarFormat: 'txt' } })).toBeNull();
    expect(parseStartExportJobInput({ projectId: '../outside' })).toBeNull();
    expect(parseStartExportJobInput({ projectId: 'project_01', width: 1279, height: 720 })).toBeNull();
    expect(parseStartExportJobInput({ projectId: 'project_01', outputPath: '/tmp/escape.mp4' })).toBeNull();
  });

  it('parses opaque export job actions and exposes the lifecycle channels', () => {
    expect(parseExportJobActionInput({ jobId: 'export_01' })).toEqual({ jobId: 'export_01' });
    expect(parseExportJobActionInput({ jobId: 'export 01' })).toBeNull();
    expect(IPC_CHANNELS.startExportJob).toBe('export:start-job');
    expect(IPC_CHANNELS.getExportJob).toBe('export:get-job');
    expect(IPC_CHANNELS.cancelExportJob).toBe('export:cancel-job');
    expect(IPC_CHANNELS.openExportResult).toBe('export:open-result');
    expect(IPC_CHANNELS.revealExportResult).toBe('export:reveal-result');
  });
});
