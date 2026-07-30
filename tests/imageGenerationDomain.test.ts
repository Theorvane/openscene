import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  getAvailableDomainModels,
  getDefaultDomainModelId,
  getDomainModel,
  getDomainModels
} from '../src/shared/aiDomainModels';

const jobManagerSource = readFileSync(resolve(process.cwd(), 'src/main/aiJobManager.ts'), 'utf8');

describe('image generation domain', () => {
  it('offers image models at all, with a usable default', () => {
    // Given / When
    const models = getDomainModels('image-generation');

    // Then
    expect(models.length).toBeGreaterThan(0);
    expect(getDefaultDomainModelId('image-generation')).toBe('gpt-image-1');
  });

  it('marks a model available only where an adapter actually exists', () => {
    // The picker offering a model the job manager cannot run turns a click into
    // a failure the user cannot act on, so availability has to track the code.
    const IMPLEMENTED_PROVIDERS = ['openai', 'google_gemini', 'byteplus'];

    for (const model of getDomainModels('image-generation')) {
      const dispatchable = IMPLEMENTED_PROVIDERS.includes(model.providerId);
      expect(model.available, `${model.providerLabel} → ${model.label}`).toBe(dispatchable);
      if (!dispatchable) {
        expect(model.unavailableReason, `${model.label} needs a reason`).toBeDefined();
      }
    }
  });

  it('dispatches every available provider id in the job manager', () => {
    // Given
    const availableProviders = new Set(getAvailableDomainModels('image-generation').map((model) => model.providerId));

    // When / Then
    for (const providerId of availableProviders) {
      expect(jobManagerSource, `no dispatch branch for ${providerId}`).toContain(`model.providerId === '${providerId}'`);
      // A provider with no credential slot would prompt for a key that is never read.
      expect(jobManagerSource, `no credential mapping for ${providerId}`).toMatch(
        new RegExp(`${providerId}: \\{ seam: '[a-z_]+', credentialKey: '[A-Za-z]+' \\}`)
      );
    }
  });

  it('keeps the Chinese providers in the catalog rather than only the western ones', () => {
    // Given / When
    const byteplus = getDomainModels('image-generation').filter((model) => model.providerId === 'byteplus');

    // Then
    expect(byteplus.map((model) => model.id)).toContain('seedream-4-0-250828');
    expect(byteplus.every((model) => model.available)).toBe(true);
  });

  it('does not leak image models into the video, voice, or agent pickers', () => {
    // Given / When / Then
    // Domains share one catalog, so a stray domain entry would put an image
    // model in the video picker, where nothing could run it.
    expect(getDomainModel('video-generation', 'gpt-image-1')).toBeUndefined();
    expect(getDomainModel('voice-generation', 'seedream-4-0-250828')).toBeUndefined();
    expect(getDomainModel('edit-agent', 'imagen-4.0-generate-001')).toBeUndefined();
  });
});

describe('still-to-video handoff', () => {
  const app = readFileSync(resolve(process.cwd(), 'src/renderer/src/App.tsx'), 'utf8');
  const imageStudio = readFileSync(resolve(process.cwd(), 'src/renderer/src/ImageGenerationWorkspace.tsx'), 'utf8');
  const videoStudio = readFileSync(resolve(process.cwd(), 'src/renderer/src/VideoGenerationWorkspace.tsx'), 'utf8');

  it('lands the still in the video form instead of describing how to do it by hand', () => {
    // The reference lives in App because both studios touch it. Held locally in
    // the video studio, "Use for video" could only ever be a suggestion to save
    // the image and pick it again.
    expect(app).toContain('const [videoReferenceImage, setVideoReferenceImage]');
    expect(videoStudio).toContain('readonly referenceImage: ReferenceImageSelection | null;');
    expect(videoStudio).not.toContain('useState<ReferenceImageSelection | null>(null)');
  });

  it('switches to the video tab as part of the handoff', () => {
    expect(app).toMatch(/setVideoReferenceImage\(reference\);\s*\n\s*selectWorkspaceTab\('video'\);/);
  });

  it('no longer tells the user to go and add the image themselves', () => {
    expect(imageStudio).not.toMatch(/open Video Generation and add it/);
    expect(imageStudio).toContain('onUseForVideo(response.value);');
  });
});
