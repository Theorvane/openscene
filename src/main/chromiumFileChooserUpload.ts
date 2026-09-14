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

export type ChromiumFileChooserDiagnostic = {
  readonly step:
    | 'picker_launcher'
    | 'picker_upload_action'
    | 'debugger_attached'
    | 'page_enabled'
    | 'interception_enabled'
    | 'references_staged'
    | 'chooser_event'
    | 'chooser_event_timeout'
    | 'dom_fallback'
    | 'files_assigned'
    | 'cdp_unavailable';
  readonly referenceCount?: number;
  readonly candidateCount?: number;
  readonly reusedDebugger?: boolean;
  readonly fallbackPageEnable?: boolean;
  readonly failedStep?: string;
};

type FileChooserOpenedParameters = {
  readonly backendNodeId?: number;
  readonly mode?: 'selectSingle' | 'selectMultiple';
};

type CdpNode = {
  readonly backendNodeId?: number;
  readonly nodeName?: string;
  readonly attributes?: readonly string[];
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

function nodeAttributes(node: CdpNode): Readonly<Record<string, string>> {
  const values = node.attributes ?? [];
  const result: Record<string, string> = {};
  for (let index = 0; index + 1 < values.length; index += 2) {
    result[values[index]!.toLowerCase()] = values[index + 1]!;
  }
  return result;
}

async function listFileInputNodes(debuggerApi: Debugger): Promise<readonly CdpNode[]> {
  const response = await debuggerApi.sendCommand('DOM.getFlattenedDocument', { depth: -1, pierce: true }) as {
    readonly nodes?: readonly CdpNode[];
  };
  return (response.nodes ?? []).filter((node) => {
    if (node.nodeName?.toUpperCase() !== 'INPUT' || node.backendNodeId === undefined) return false;
    const attributes = nodeAttributes(node);
    return attributes.type?.toLowerCase() === 'file'
      && (attributes.accept === undefined || attributes.accept.length === 0 || attributes.accept.toLowerCase().includes('image'));
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
  timeoutMs = 5_000,
  onDiagnostic: (details: ChromiumFileChooserDiagnostic) => void = () => undefined
): Promise<ChromiumFileChooserUpload | null> {
  if (references.length === 0) return null;
  const debuggerApi = webContents.debugger;
  if (debuggerApi === undefined) return null;

  let ownsDebugger = false;
  let interceptionEnabled = false;
  let currentStep = 'attach';
  let staged: Awaited<ReturnType<typeof stageReferences>> | undefined;
  try {
    if (!debuggerApi.isAttached()) {
      debuggerApi.attach('1.3');
      ownsDebugger = true;
    }
    onDiagnostic({ step: 'debugger_attached', reusedDebugger: !ownsDebugger });
    currentStep = 'page_enable';
    let fallbackPageEnable = false;
    try {
      // Chromium requires this opt-in on builds where chooser interception and
      // chooser event delivery are independently gated.
      await debuggerApi.sendCommand('Page.enable', { enableFileChooserOpenedEvent: true });
    } catch {
      fallbackPageEnable = true;
      await debuggerApi.sendCommand('Page.enable');
    }
    onDiagnostic({ step: 'page_enabled', fallbackPageEnable });
    currentStep = 'dom_enable';
    await debuggerApi.sendCommand('DOM.enable');
    currentStep = 'intercept_enable';
    await debuggerApi.sendCommand('Page.setInterceptFileChooserDialog', { enabled: true });
    interceptionEnabled = true;
    onDiagnostic({ step: 'interception_enabled' });
    currentStep = 'stage_references';
    staged = await stageReferences(references);
    onDiagnostic({ step: 'references_staged', referenceCount: staged.files.length });

    // Snapshot existing inputs so the fallback cannot accidentally populate a
    // stale upload slot from an earlier style/character reference.
    const inputsBefore = await listFileInputNodes(debuggerApi).catch(() => []);
    const existingBackendIds = new Set(inputsBefore.flatMap((node) => node.backendNodeId === undefined ? [] : [node.backendNodeId]));

    currentStep = 'trigger_chooser';
    const chooserPromise = waitForFileChooser(debuggerApi, Math.min(timeoutMs, 1_000));
    triggerChooser();
    const chooser = await chooserPromise;
    let backendNodeId = chooser?.backendNodeId;
    if (chooser !== null) {
      onDiagnostic({ step: 'chooser_event' });
      if (references.length > 1 && chooser.mode !== 'selectMultiple') {
        throw new Error('Google Flow opened a single-file chooser, so OpenScene refused to silently drop reference images.');
      }
    } else {
      onDiagnostic({ step: 'chooser_event_timeout' });
      currentStep = 'dom_fallback';
      const inputsAfter = await listFileInputNodes(debuggerApi).catch(() => []);
      const newInputs = inputsAfter.filter((node) => node.backendNodeId !== undefined && !existingBackendIds.has(node.backendNodeId));
      const candidates = newInputs.length > 0 ? newInputs : inputsAfter;
      const compatible = candidates.filter((node) => references.length === 1 || Object.hasOwn(nodeAttributes(node), 'multiple'));
      backendNodeId = compatible.at(-1)?.backendNodeId;
      onDiagnostic({ step: 'dom_fallback', candidateCount: compatible.length });
    }
    if (backendNodeId === undefined) {
      throw new Error('Google Flow opened a file chooser without an assignable upload control.');
    }

    currentStep = 'set_files';
    await debuggerApi.sendCommand('DOM.setFileInputFiles', {
      files: staged.files,
      backendNodeId
    });
    onDiagnostic({ step: 'files_assigned', referenceCount: staged.files.length });
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
    if (!interceptionEnabled) {
      onDiagnostic({ step: 'cdp_unavailable', failedStep: currentStep });
      return null;
    }
    throw error;
  } finally {
    if (interceptionEnabled) {
      await debuggerApi.sendCommand('Page.setInterceptFileChooserDialog', { enabled: false }).catch(() => undefined);
    }
    if (ownsDebugger && debuggerApi.isAttached()) debuggerApi.detach();
  }
}
