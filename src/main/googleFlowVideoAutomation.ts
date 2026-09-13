import type { KeyboardInputEvent, Rectangle, WebContents } from 'electron';
import {
  googleFlowVideoModelLabel,
  googleFlowVideoDurationOptions,
  type GoogleFlowVideoModel
} from '../shared/browserSession';
import type { ReferenceImageSelection } from '../shared/providerSeams';
import type { VideoOperation } from '../shared/mediaCapabilityRegistry';
import { BrowserGenerationActionRequiredError } from './browserGenerationAction';
import {
  uploadReferencesThroughChromiumFileChooser,
  type ChromiumFileChooserUpload
} from './chromiumFileChooserUpload';
import {
  buildGoogleFlowStateProbeScript,
  rememberGoogleFlowProjectUrl,
  renameGoogleFlowProject,
  waitForGoogleFlowProjectEditor,
  type GoogleFlowAutomationState
} from './googleFlowImageAutomation';

const POLL_INTERVAL_MS = 1_000;

type RectangleWithText = {
  readonly rectangle: Rectangle;
  readonly text: string;
  readonly selected?: boolean;
};

type AutomationState = GoogleFlowAutomationState;

export type GoogleFlowVideoAutomationProgress =
  | 'loading'
  | 'project'
  | 'ready'
  | 'configuring'
  | 'uploading'
  | 'submitted'
  | 'generating'
  | 'downloading';

export type GoogleFlowVideoAutomationInput = {
  readonly prompt: string;
  readonly model: GoogleFlowVideoModel;
  readonly operation: VideoOperation;
  readonly aspectRatio: string;
  readonly durationSeconds: number;
  readonly referenceImage?: ReferenceImageSelection;
  readonly lastFrame?: ReferenceImageSelection;
  readonly referenceImages?: readonly ReferenceImageSelection[];
  readonly timeoutMs: number;
  readonly projectName?: string;
  readonly onProgress?: (
    stage: GoogleFlowVideoAutomationProgress,
    elapsedMs: number,
    details?: Readonly<Record<string, unknown>>
  ) => void;
};

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function normalized(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[đĐ]/g, 'd')
    .toLowerCase().replace(/\s+/g, ' ').trim();
}

function clickAt(webContents: WebContents, rectangle: Rectangle): void {
  const x = Math.round(rectangle.x + rectangle.width / 2);
  const y = Math.round(rectangle.y + rectangle.height / 2);
  webContents.sendInputEvent({ type: 'mouseMove', x, y });
  webContents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
  webContents.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 });
}

function pressKey(webContents: WebContents, keyCode: string, modifiers?: KeyboardInputEvent['modifiers']): void {
  webContents.sendInputEvent({ type: 'keyDown', keyCode, ...(modifiers === undefined ? {} : { modifiers }) });
  webContents.sendInputEvent({ type: 'keyUp', keyCode, ...(modifiers === undefined ? {} : { modifiers }) });
}

async function readState(webContents: WebContents): Promise<AutomationState> {
  return webContents.executeJavaScript(buildGoogleFlowStateProbeScript(), true) as Promise<AutomationState>;
}

function throwForAction(state: AutomationState): void {
  if (state.actionRequired === 'sign_in') throw new BrowserGenerationActionRequiredError('sign_in', 'The Google Flow session has expired. Sign in again in Settings, then start a new generation.');
  if (state.actionRequired === 'verification') throw new BrowserGenerationActionRequiredError('verification', 'Google requires CAPTCHA or account verification. Complete it manually in the Flow session, then start a new generation.');
  if (state.actionRequired === 'rate_limit') throw new BrowserGenerationActionRequiredError('rate_limit', 'Google Flow has reached the account usage or credit limit. Check the Google plan before starting a new generation.');
  if (state.actionRequired === 'unavailable') throw new BrowserGenerationActionRequiredError('unavailable', 'Google Flow video is unavailable for this account or region.');
}

function choice(state: AutomationState, expected: string): RectangleWithText | undefined {
  const target = normalized(expected);
  const choices = [...state.tabs, ...state.menuItems];
  return choices.find((entry) => normalized(entry.text) === target)
    ?? choices.find((entry) => normalized(entry.text).includes(target));
}

function choiceAny(state: AutomationState, expected: readonly string[]): RectangleWithText | undefined {
  return expected.map((label) => choice(state, label)).find((entry) => entry !== undefined);
}

async function selectChoice(webContents: WebContents, configButton: Rectangle, expected: string | readonly string[]): Promise<void> {
  const labels = typeof expected === 'string' ? [expected] : expected;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const state = await readState(webContents);
    throwForAction(state);
    const target = choiceAny(state, labels);
    if (target !== undefined) {
      if (!target.selected) {
        clickAt(webContents, target.rectangle);
        await delay(450);
      }
      return;
    }
    if (attempt === 3 || attempt === 7) {
      clickAt(webContents, state.configButton?.rectangle ?? configButton);
    }
    await delay(250);
  }
  throw new Error(`Google Flow configuration did not expose ${labels[0]} after waiting for the menu to load.`);
}

export function validateGoogleFlowVideoAutomationInput(input: Pick<GoogleFlowVideoAutomationInput, 'model' | 'operation' | 'aspectRatio' | 'durationSeconds' | 'referenceImage' | 'lastFrame' | 'referenceImages'>): void {
  if (!['16:9', '9:16'].includes(input.aspectRatio)) throw new Error('Google Flow video supports only 16:9 or 9:16.');
  if (!googleFlowVideoDurationOptions(input.model).includes(input.durationSeconds)) {
    throw new Error(`${googleFlowVideoModelLabel(input.model)} exposes ${googleFlowVideoDurationOptions(input.model).join(', ')} second video generation in Flow.`);
  }
  if (input.operation === 'video_edit' || input.operation === 'video_extend' || input.operation === 'motion_control') {
    throw new Error(`Google Flow browser session does not support ${input.operation}. Use the matching API or local worker.`);
  }
  if ((input.operation === 'image_to_video' || input.operation === 'start_end') && input.referenceImage === undefined) {
    throw new Error('Google Flow image-to-video requires a first frame.');
  }
  if (input.operation === 'start_end' && input.lastFrame === undefined) throw new Error('Google Flow Start-End requires a last frame.');
  if (input.operation === 'reference_to_video' && (input.referenceImages?.length ?? 0) === 0) {
    throw new Error('Google Flow reference-to-video requires at least one component image.');
  }
}

async function configure(webContents: WebContents, ready: AutomationState, input: GoogleFlowVideoAutomationInput): Promise<void> {
  const configButton = ready.configButton!.rectangle;
  clickAt(webContents, configButton);
  await delay(650);
  await selectChoice(webContents, configButton, 'Video');
  await selectChoice(webContents, configButton, input.operation === 'reference_to_video'
    ? ['Components', 'Component', 'Thanh phan']
    : ['Frames', 'Frame', 'Khung hinh']);

  let state = await readState(webContents);
  throwForAction(state);
  const expectedModel = googleFlowVideoModelLabel(input.model);
  const currentModel = `${state.modelDropdown?.text ?? ''} ${state.configButton?.text ?? ''}`;
  if (!normalized(currentModel).includes(normalized(expectedModel))) {
    if (state.modelDropdown === undefined) throw new Error('Google Flow loaded, but its video model selector was not found.');
    clickAt(webContents, state.modelDropdown.rectangle);
    await delay(450);
    state = await readState(webContents);
    const modelChoice = choice(state, expectedModel);
    if (modelChoice === undefined) throw new Error(`This Google Flow account does not expose ${expectedModel}.`);
    clickAt(webContents, modelChoice.rectangle);
    await delay(500);
  }

  // Selecting a model can reset the controls below it, so apply shape/count
  // afterwards. Omni exposes explicit quality and duration controls; the Veo
  // groups currently lock both to 720p / 8 seconds and remove those controls.
  await selectChoice(webContents, configButton, input.aspectRatio);
  await selectChoice(webContents, configButton, 'x1');
  if (input.model === 'omni-1.1-flash') {
    await selectChoice(webContents, configButton, '720p');
    await selectChoice(webContents, configButton, [
      `${input.durationSeconds} seconds`,
      `${input.durationSeconds}s`,
      `${input.durationSeconds} giay`
    ]);
  }
  pressKey(webContents, 'ESCAPE');
}

function safeReferenceName(reference: ReferenceImageSelection, index: number): string {
  const extension = reference.mimeType === 'image/png' ? 'png' : reference.mimeType === 'image/webp' ? 'webp' : 'jpg';
  const base = reference.displayName.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 70).replace(/\.+$/, '');
  return `${base || `reference-${index + 1}`}.${extension}`;
}

async function injectImageFile(webContents: WebContents, reference: ReferenceImageSelection, index: number): Promise<void> {
  const script = `(() => {
    const input = [...document.querySelectorAll('input[type="file"]')]
      .find((candidate) => !candidate.disabled && (!candidate.accept || candidate.accept.includes('image')));
    if (!(input instanceof HTMLInputElement)) return false;
    const binary = atob(${JSON.stringify(reference.base64)});
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    const transfer = new DataTransfer();
    transfer.items.add(new File([bytes], ${JSON.stringify(safeReferenceName(reference, index))}, { type: ${JSON.stringify(reference.mimeType)} }));
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`;
  const injected = await webContents.executeJavaScript(script, true) as boolean;
  if (!injected) throw new Error('Google Flow opened its media picker, but no image upload control was available. Import the image into Flow manually and retry.');
  await delay(800);
}

async function attachReferences(webContents: WebContents, input: GoogleFlowVideoAutomationInput): Promise<ChromiumFileChooserUpload> {
  const references = input.operation === 'reference_to_video'
    ? input.referenceImages ?? []
    : [input.referenceImage, input.lastFrame].filter((entry): entry is ReferenceImageSelection => entry !== undefined);
  const uploads: ChromiumFileChooserUpload[] = [];
  try {
    for (let index = 0; index < references.length; index += 1) {
      const state = await readState(webContents);
      const targetLabels = input.operation === 'reference_to_video'
        ? ['Component', 'Components', 'Thanh phan']
        : index === 0 ? ['Start', 'Bat dau'] : ['End', 'Ket thuc'];
      const target = choiceAny(state, targetLabels);
      if (target === undefined) throw new Error(`Google Flow did not expose the ${targetLabels[0]} reference control.`);
      const upload = await uploadReferencesThroughChromiumFileChooser(
        webContents,
        [references[index]!],
        () => clickAt(webContents, target.rectangle)
      );
      if (upload !== null) {
        uploads.push(upload);
      } else {
        await delay(500);
        await injectImageFile(webContents, references[index]!, index);
      }
    }
    return {
      cleanup: async () => {
        await Promise.all(uploads.map((upload) => upload.cleanup().catch(() => undefined)));
      }
    };
  } catch (error) {
    await Promise.all(uploads.map((upload) => upload.cleanup().catch(() => undefined)));
    throw error;
  }
}

async function fillPrompt(webContents: WebContents, prompt: string, deadline: number): Promise<AutomationState> {
  let inserted = false;
  while (Date.now() < deadline) {
    const state = await readState(webContents);
    throwForAction(state);
    if (!inserted && state.input !== undefined) {
      clickAt(webContents, state.input);
      await delay(120);
      pressKey(webContents, 'A', ['control']);
      await webContents.insertText(prompt);
      inserted = true;
      await delay(300);
      continue;
    }
    if (inserted && state.submit !== undefined) return state;
    await delay(POLL_INTERVAL_MS);
  }
  throw new Error('Google Flow loaded, but its video prompt/Create controls could not be found.');
}

export async function automateGoogleFlowVideoGeneration(webContents: WebContents, input: GoogleFlowVideoAutomationInput): Promise<string> {
  validateGoogleFlowVideoAutomationInput(input);
  const startedAt = Date.now();
  const deadline = startedAt + input.timeoutMs;
  input.onProgress?.('loading', 0);
  let referenceUpload: ChromiumFileChooserUpload | null = null;
  try {
    const project = await waitForGoogleFlowProjectEditor(webContents, deadline, input.projectName, (details) => {
      input.onProgress?.('project', Date.now() - startedAt, details);
    });
    let ready = project.state;
    if (input.projectName !== undefined) {
      await rememberGoogleFlowProjectUrl(webContents, input.projectName, ready.url).catch(() => undefined);
    }
    if (project.createdProject && input.projectName !== undefined) {
      const renamed = await renameGoogleFlowProject(webContents, input.projectName, Math.min(deadline, Date.now() + 15_000));
      input.onProgress?.('project', Date.now() - startedAt, {
        projectName: input.projectName,
        projectCreated: true,
        projectRenamed: renamed,
        projectReuseStored: true
      });
      ready = await readState(webContents);
    }
    input.onProgress?.('ready', Date.now() - startedAt);
    await configure(webContents, ready, input);
    input.onProgress?.('configuring', Date.now() - startedAt, { model: googleFlowVideoModelLabel(input.model) });
    if (input.operation !== 'text_to_video') {
      input.onProgress?.('uploading', Date.now() - startedAt, { referenceCount: input.operation === 'reference_to_video' ? input.referenceImages?.length ?? 0 : input.operation === 'start_end' ? 2 : 1 });
      referenceUpload = await attachReferences(webContents, input);
    }
    ready = await fillPrompt(webContents, input.prompt, deadline);
    const existingVideos = new Set((ready.videos ?? []).map((video) => video.src));
    clickAt(webContents, ready.submit!);
    input.onProgress?.('submitted', Date.now() - startedAt);

    let lastHeartbeat = 0;
    while (Date.now() < deadline) {
      await delay(POLL_INTERVAL_MS);
      const state = await readState(webContents);
      throwForAction(state);
      const elapsed = Date.now() - startedAt;
      if (elapsed - lastHeartbeat >= 10_000) {
        lastHeartbeat = elapsed;
        input.onProgress?.('generating', elapsed);
      }
      const generated = (state.videos ?? []).find((video) => !existingVideos.has(video.src));
      if (generated !== undefined) {
        input.onProgress?.('downloading', elapsed);
        return generated.src;
      }
    }
    throw new Error('Google Flow did not produce a video before the timeout. Check credits, model access, and the prompt, then retry.');
  } finally {
    await referenceUpload?.cleanup().catch(() => undefined);
  }
}

export function detectDownloadedMp4(bytes: Uint8Array): boolean {
  if (bytes.length < 12) return false;
  const box = String.fromCharCode(bytes[4]!, bytes[5]!, bytes[6]!, bytes[7]!);
  const brand = String.fromCharCode(bytes[8]!, bytes[9]!, bytes[10]!, bytes[11]!);
  return box === 'ftyp' && /^(isom|iso\d|mp4\d|M4V |MSNV|avc1|dash)$/.test(brand);
}
