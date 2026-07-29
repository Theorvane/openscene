import { readFile } from 'node:fs/promises';
import { basename, extname } from 'node:path';

import type { ApiResponse } from '../shared/models';
import type { ReferenceImageSelection } from '../shared/providerSeams';
import { fail, ok } from './ipcResponses';

/**
 * Reference image for image-to-video generation. The picker lives in the main
 * process because the renderer has no filesystem access: it returns the bytes
 * inline as base64 rather than a path, so the renderer never learns where the
 * file lives and the provider adapter can post it directly.
 */
export const REFERENCE_IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp'] as const;

/** Provider limits are far lower; this only stops the IPC payload exploding. */
export const REFERENCE_IMAGE_MAX_BYTES = 8 * 1024 * 1024;

const MIME_TYPES: Readonly<Record<string, string>> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp'
};

export type ReferenceImageDialog = () => Promise<{ readonly canceled: boolean; readonly filePaths: readonly string[] }>;

export type ReferenceImageReader = (filePath: string) => Promise<Buffer>;

export async function selectReferenceImage(
  showDialog: ReferenceImageDialog,
  read: ReferenceImageReader = readFile
): Promise<ApiResponse<ReferenceImageSelection | null>> {
  const selection = await showDialog();
  const filePath = selection.canceled ? undefined : selection.filePaths[0];
  if (filePath === undefined) return ok(null);

  const mimeType = MIME_TYPES[extname(filePath).toLowerCase()];
  if (mimeType === undefined) {
    return fail('INVALID_INPUT', `Reference images must be one of: ${REFERENCE_IMAGE_EXTENSIONS.join(', ')}.`);
  }

  try {
    const bytes = await read(filePath);
    if (bytes.byteLength > REFERENCE_IMAGE_MAX_BYTES) {
      return fail('INVALID_INPUT', `The reference image is larger than ${REFERENCE_IMAGE_MAX_BYTES / (1024 * 1024)}MB.`);
    }
    return ok({ displayName: basename(filePath), mimeType, base64: bytes.toString('base64') });
  } catch {
    return fail('INVALID_INPUT', 'The reference image could not be read.');
  }
}
