import { describe, expect, it, vi } from 'vitest';

import {
  REFERENCE_IMAGE_MAX_BYTES,
  selectReferenceImage
} from '../src/main/referenceImagePicker';

const dialogReturning = (filePaths: readonly string[], canceled = false) =>
  vi.fn(async () => ({ canceled, filePaths }));

describe('reference image picker', () => {
  it('returns the bytes inline with a mime type, never the path', async () => {
    const read = vi.fn(async () => Buffer.from('image-bytes'));

    const response = await selectReferenceImage(dialogReturning(['/Users/someone/Pictures/shot.PNG']), read);

    expect(response.ok).toBe(true);
    expect(response.ok && response.value).toEqual({
      displayName: 'shot.PNG',
      mimeType: 'image/png',
      base64: Buffer.from('image-bytes').toString('base64')
    });
    // The renderer must never learn where the file lives.
    expect(JSON.stringify(response)).not.toContain('/Users/someone');
  });

  it('treats a cancelled dialog as no selection rather than an error', async () => {
    const response = await selectReferenceImage(dialogReturning([], true), vi.fn());

    expect(response).toEqual({ ok: true, value: null });
  });

  it('refuses a file type no provider accepts', async () => {
    const read = vi.fn();

    const response = await selectReferenceImage(dialogReturning(['/tmp/clip.mp4']), read);

    expect(response.ok).toBe(false);
    expect(response.ok || response.error.message).toContain('png, jpg, jpeg, webp');
    // Rejected before reading anything off disk.
    expect(read).not.toHaveBeenCalled();
  });

  it('refuses an image too large to ship over IPC', async () => {
    const read = vi.fn(async () => Buffer.alloc(REFERENCE_IMAGE_MAX_BYTES + 1));

    const response = await selectReferenceImage(dialogReturning(['/tmp/huge.jpg']), read);

    expect(response.ok).toBe(false);
    expect(response.ok || response.error.message).toContain('larger than 8MB');
  });
});
