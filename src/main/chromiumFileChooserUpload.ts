import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import type { Debugger, Event, WebContents } from 'electron';
import type { ReferenceImageSelection } from '../shared/providerSeams';
import { REFERENCE_IMAGE_MAX_BYTES } from './referenceImagePicker';

const TEMPORARY_DIRECTORY_PREFIX = 'openscene-flow-reference-';

export type ChromiumFileChooserUpload = {
  /** Keep staged files alive until Flow has finished consuming the upload. */
  readonly cleanup: () => Promise<void>;
};

type FileChooserOpenedParameters = {
  readonly backendNodeId?: number;
  readonly mode?: 'selectSingle' | 'selectMultiple';
};

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function safeReferenceName(reference: ReferenceImageSelection, index: number): string {
  const extension = reference.mimeType === 'image/png' ? '.png' : reference.mimeType === 'image/webp' ? '.webp' : '.jpg';
  const originalExtension = extname(reference.displayName);
  const stem = reference.displayName.slice(0, originalExtension.length === 0 ? undefined : -originalExtension.length)
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .slice(0, 64)
    .replace(/^\.+|\.+$/g, '');
  return `${String(index + 1).padStart(2, '0')}-${stem || 'reference'}${extension}`;
}

function decodeReference(reference: ReferenceImageSelection): Buffer {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(reference.mimeType)) {
    throw new Error(`Google Flow cannot upload the reference MIME type ${reference.mimeType}.`);
  }
  if (reference.base64.length > Math.ceil(REFERENCE_IMAGE_MAX_BYTES * 4 / 3) + 4) {
    throw new Error(`The reference image ${reference.displayName} is larger than ${REFERENCE_IMAGE_MAX_BYTES / (1024 * 1024)} MB.`);
  }
  if (!/^[a-zA-Z0-9+/]*={0,2}$/.test(reference.base64) || reference.base64.length % 4 === 1) {
    throw new Error(`The reference image ${reference.displayName} is not valid base64 data.`);
  }
  const bytes = Buffer.from(reference.base64, 'base64');
  if (bytes.length === 0 || bytes.length > REFERENCE_IMAGE_MAX_BYTES) {
    throw new Error(`The reference image ${reference.displayName} must be between 1 byte and ${REFERENCE_IMAGE_MAX_BYTES / (1024 * 1024)} MB.`);
  }
  return bytes;
}

async function stageReferences(references: readonly ReferenceImageSelection[]): Promise<{
  readonly directory: string;
  readonly files: readonly string[];
}> {
  const directory = await mkdtemp(join(tmpdir(), TEMPORARY_DIRECTORY_PREFIX));
  try {
    const files: string[] = [];
    for (let index = 0; index < references.length; index += 1) {
      const target = join(directory, safeReferenceName(references[index]!, index));
      await writeFile(target, decodeReference(references[index]!), { flag: 'wx', mode: 0o600 });
      files.push(target);
    }
    return { directory, files };
  } catch (error) {
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }).catch(() => undefined);
    throw error;
  }
}

function waitForFileChooser(debuggerApi: Debugger, timeoutMs: number): Promise<FileChooserOpenedParameters | null> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: FileChooserOpenedParameters | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      debuggerApi.removeListener('message', onMessage);
      resolve(value);
    };
    const onMessage = (_event: Event, method: string, params: FileChooserOpenedParameters): void => {
      if (method === 'Page.fileChooserOpened') finish(params);
    };
    const timeout = setTimeout(() => finish(null), timeoutMs);
    debuggerApi.on('message', onMessage);
  });
}

/**
 * Assign local reference files to Chromium's real file chooser through the
 * DevTools protocol. Current Google Flow deliberately keeps the chooser's file
 * input outside page-script reach, so DOM/DataTransfer injection cannot handle
 * it. Paths remain main-process-only and staged files are removed by cleanup.
 *
 * Returns null when this Chromium build cannot intercept file choosers, which
 * lets callers retain their legacy DOM fallback for older Flow layouts.
 */
export async function uploadReferencesThroughChromiumFileChooser(
  webContents: WebContents,
  references: readonly ReferenceImageSelection[],
  triggerChooser: () => void,
  timeoutMs = 5_000
): Promise<ChromiumFileChooserUpload | null> {
  if (references.length === 0) return null;
  const debuggerApi = webContents.debugger;
  if (debuggerApi === undefined) return null;

  let ownsDebugger = false;
  let interceptionEnabled = false;
  let staged: Awaited<ReturnType<typeof stageReferences>> | undefined;
  try {
    if (!debuggerApi.isAttached()) {
      debuggerApi.attach('1.3');
      ownsDebugger = true;
    }
    await debuggerApi.sendCommand('Page.enable');
    await debuggerApi.sendCommand('DOM.enable');
    await debuggerApi.sendCommand('Page.setInterceptFileChooserDialog', { enabled: true });
    interceptionEnabled = true;
    staged = await stageReferences(references);

    const chooserPromise = waitForFileChooser(debuggerApi, timeoutMs);
    triggerChooser();
    const chooser = await chooserPromise;
    if (chooser === null) {
      await rm(staged.directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }).catch(() => undefined);
      staged = undefined;
      return null;
    }
    if (chooser.backendNodeId === undefined) {
      throw new Error('Google Flow opened a file chooser without an assignable upload control.');
    }
    if (references.length > 1 && chooser.mode !== 'selectMultiple') {
      throw new Error('Google Flow opened a single-file chooser, so OpenScene refused to silently drop reference images.');
    }

    await debuggerApi.sendCommand('DOM.setFileInputFiles', {
      files: staged.files,
      backendNodeId: chooser.backendNodeId
    });
    // Allow Flow's change handler to take ownership before the debugger is
    // detached. Files themselves remain staged until the generation exits.
    await delay(800);
    const directory = staged.directory;
    staged = undefined;
    return {
      cleanup: () => rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 }).then(() => undefined)
    };
  } catch (error) {
    if (staged !== undefined) {
      await rm(staged.directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }).catch(() => undefined);
    }
    // Failure to attach or enable interception means an older Electron/Flow
    // combination may still be served by the caller's DOM fallback.
    if (!interceptionEnabled) return null;
    throw error;
  } finally {
    if (interceptionEnabled) {
      await debuggerApi.sendCommand('Page.setInterceptFileChooserDialog', { enabled: false }).catch(() => undefined);
    }
    if (ownsDebugger && debuggerApi.isAttached()) debuggerApi.detach();
  }
}
