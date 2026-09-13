import type { KeyboardInputEvent, Rectangle, WebContents } from 'electron';
import type { ReferenceImageSelection } from '../shared/providerSeams';
import { BrowserGenerationActionRequiredError } from './browserGenerationAction';

const POLL_INTERVAL_MS = 1_000;

type RectangleWithText = { readonly rectangle: Rectangle; readonly text: string; readonly selected?: boolean };

type GrokMedia = { readonly rectangle: Rectangle; readonly src: string };

export type GrokImagineAutomationState = {
  readonly url: string;
  readonly input?: Rectangle;
  readonly submit?: Rectangle;
  readonly imageMode?: RectangleWithText;
  readonly videoMode?: RectangleWithText;
  readonly durationButton?: RectangleWithText;
  readonly resolutionButton?: RectangleWithText;
  readonly aspectButton?: RectangleWithText;
  readonly images: readonly GrokMedia[];
  readonly videos: readonly GrokMedia[];
  readonly actionRequired?: 'sign_in' | 'verification' | 'rate_limit' | 'unavailable';
};

export type GrokImagineAutomationProgress = 'loading' | 'ready' | 'configuring' | 'uploading' | 'submitted' | 'generating' | 'downloading';

export type GrokImagineAutomationInput = {
  readonly prompt: string;
  readonly operation: 'image' | 'text_to_video' | 'image_to_video';
  readonly aspectRatio: string;
  readonly durationSeconds?: number;
  readonly referenceImage?: ReferenceImageSelection;
  readonly timeoutMs: number;
  readonly onProgress?: (stage: GrokImagineAutomationProgress, elapsedMs: number, details?: Readonly<Record<string, unknown>>) => void;
};

export function buildGrokImaginePrompt(
  prompt: string,
  options: { readonly stylePreset?: string | undefined; readonly negativePrompt?: string | undefined } = {}
): string {
  const parts = [prompt.trim()];
  const stylePreset = options.stylePreset?.trim();
  if (stylePreset !== undefined && stylePreset.length > 0 && stylePreset !== 'Writer Style Bible' && stylePreset !== 'Workflow controlled') {
    parts.push(`Visual style: ${stylePreset}.`);
  }
  const negativePrompt = options.negativePrompt?.trim();
  if (negativePrompt !== undefined && negativePrompt.length > 0) parts.push(`Avoid: ${negativePrompt}.`);
  return parts.join('\n');
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function normalized(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
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

/**
 * Probe only visible geometry, labels, and media URLs. It deliberately does
 * not expose account text, prompt text, cookies, or network response bodies.
 */
export function buildGrokImagineStateProbeScript(): string {
  return `(() => {
    const visibleRect = (element) => {
      if (!(element instanceof HTMLElement)) return null;
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      if (style.visibility === 'hidden' || style.display === 'none' || rect.width < 2 || rect.height < 2) return null;
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    };
    const label = (element) => (element.textContent || element.getAttribute('aria-label') || element.getAttribute('title') || '').trim();
    const visible = (selector) => [...document.querySelectorAll(selector)]
      .map((element) => ({ element, rectangle: visibleRect(element) }))
      .filter((entry) => entry.rectangle);
    const body = (document.body?.innerText || '').toLowerCase();
    const actionRequired = /captcha|cloudflare|verify you are human|xác minh|verification|challenge/.test(body)
      ? 'verification'
      : /rate limit|too many|credit limit|quota|hết lượt|credits/.test(body)
        ? 'rate_limit'
        : /sign in|log in|đăng nhập|session expired/.test(body) && !document.querySelector('[data-testid="chat-input"]')
          ? 'sign_in'
          : undefined;
    const buttons = visible('button, [role="button"]');
    const radio = (names) => {
      const choices = Array.isArray(names) ? names : [names];
      const entry = buttons.find(({ element }) => choices.some((name) => (element.getAttribute('aria-label') || label(element)).trim().toLowerCase() === name.toLowerCase()));
      return entry ? { rectangle: entry.rectangle, text: label(entry.element), selected: entry.element.getAttribute('aria-checked') === 'true' } : undefined;
    };
    const named = (aria) => {
      const entry = buttons.find(({ element }) => element.getAttribute('aria-label') === aria);
      return entry ? { rectangle: entry.rectangle, text: label(entry.element), selected: entry.element.getAttribute('aria-pressed') === 'true' } : undefined;
    };
    const inputs = visible('[contenteditable="true"], textarea, [role="textbox"]');
    const input = inputs.find(({ element, rectangle }) => rectangle.width > 120 && (element.getAttribute('aria-label') || '').toLowerCase().includes('ask grok'))?.rectangle
      || inputs.find(({ rectangle }) => rectangle.width > 120 && rectangle.y > window.innerHeight * 0.45)?.rectangle;
    const submitEntry = buttons.find(({ element }) => element.getAttribute('aria-label') === 'Gửi' || element.getAttribute('aria-label') === 'Send');
    const media = (selector) => visible(selector).flatMap(({ element, rectangle }) => {
      const src = element.currentSrc || element.src || element.querySelector?.('source')?.src || '';
      return src && rectangle.width > 100 && rectangle.height > 80 ? [{ rectangle, src }] : [];
    });
    return {
      url: location.href,
      ...(input ? { input } : {}),
      ...(submitEntry ? { submit: submitEntry.rectangle } : {}),
      ...(radio(['Hình ảnh', 'Image']) ? { imageMode: radio(['Hình ảnh', 'Image']) } : {}),
      ...(radio(['Video']) ? { videoMode: radio(['Video']) } : {}),
      ...(named('Thời lượng video') || named('Video duration') ? { durationButton: named('Thời lượng video') || named('Video duration') } : {}),
      ...(named('Độ phân giải video') || named('Video resolution') ? { resolutionButton: named('Độ phân giải video') || named('Video resolution') } : {}),
      ...(named('Tỷ lệ khung hình') || named('Aspect ratio') ? { aspectButton: named('Tỷ lệ khung hình') || named('Aspect ratio') } : {}),
      images: media('img'),
      videos: media('video'),
      ...(actionRequired ? { actionRequired } : {})
    };
  })()`;
}

async function readState(webContents: WebContents): Promise<GrokImagineAutomationState> {
  return webContents.executeJavaScript(buildGrokImagineStateProbeScript(), true) as Promise<GrokImagineAutomationState>;
}

function throwForAction(state: GrokImagineAutomationState): void {
  if (state.actionRequired === 'sign_in') throw new BrowserGenerationActionRequiredError('sign_in', 'The Grok browser session has expired. Sign in again in Settings, then start a new generation.');
  if (state.actionRequired === 'verification') throw new BrowserGenerationActionRequiredError('verification', 'Grok requires CAPTCHA or account verification. Complete it manually in the signed-in session, then start a new generation.');
  if (state.actionRequired === 'rate_limit') throw new BrowserGenerationActionRequiredError('rate_limit', 'Grok has reached the account usage or credit limit. Check the account before starting a new generation.');
  if (state.actionRequired === 'unavailable') throw new BrowserGenerationActionRequiredError('unavailable', 'Grok Imagine is unavailable for this account or region.');
}

async function selectMenuText(webContents: WebContents, button: Rectangle | undefined, expected: string): Promise<void> {
  if (button === undefined) throw new Error(`Grok Imagine did not expose the control required to select ${expected}.`);
  clickAt(webContents, button);
  await delay(250);
  const selected = await webContents.executeJavaScript(`(() => {
    const target = ${JSON.stringify(normalized(expected))};
    const visible = (element) => { const r = element.getBoundingClientRect(); const s = getComputedStyle(element); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
    const candidates = [...document.querySelectorAll('[role="menuitemradio"], [role="menuitem"], [role="option"], button')]
      .filter(visible).map((element) => ({ element, text: (element.textContent || element.getAttribute('aria-label') || '').normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').trim().toLowerCase().replace(/\\s+/g, ' ') }));
    const entry = candidates.find(({ text }) => text === target) || candidates.find(({ text }) => text.includes(target));
    if (!entry) return false;
    entry.element.click();
    return true;
  })()`, true) as boolean;
  if (!selected) pressKey(webContents, 'ESCAPE');
  if (!selected) throw new Error(`Grok Imagine did not expose the ${expected} option.`);
  await delay(350);
}

async function injectImageFile(webContents: WebContents, reference: ReferenceImageSelection): Promise<void> {
  const safeName = reference.displayName.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 70) || 'reference-image';
  const script = `(() => {
    const input = [...document.querySelectorAll('input[type="file"]')].find((candidate) => !candidate.disabled && (!candidate.accept || candidate.accept.includes('image')));
    if (!(input instanceof HTMLInputElement)) return false;
    const binary = atob(${JSON.stringify(reference.base64)});
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    const transfer = new DataTransfer();
    transfer.items.add(new File([bytes], ${JSON.stringify(safeName)}, { type: ${JSON.stringify(reference.mimeType)} }));
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`;
  const injected = await webContents.executeJavaScript(script, true) as boolean;
  if (!injected) throw new Error('Grok opened its media picker, but no image upload control was available. Import the image manually and retry.');
  await delay(800);
}

async function fillPrompt(webContents: WebContents, prompt: string, deadline: number): Promise<GrokImagineAutomationState> {
  while (Date.now() < deadline) {
    const state = await readState(webContents);
    throwForAction(state);
    if (state.input !== undefined) {
      clickAt(webContents, state.input);
      await delay(100);
      pressKey(webContents, 'A', [process.platform === 'darwin' ? 'meta' : 'control']);
      await webContents.insertText(prompt);
      await delay(250);
      const withSubmit = await readState(webContents);
      if (withSubmit.submit !== undefined) return withSubmit;
    }
    await delay(POLL_INTERVAL_MS);
  }
  throw new Error('Grok Imagine loaded, but its prompt/send controls could not be found.');
}

export async function automateGrokImagineGeneration(webContents: WebContents, input: GrokImagineAutomationInput): Promise<string> {
  const startedAt = Date.now();
  const deadline = startedAt + input.timeoutMs;
  input.onProgress?.('loading', 0);
  let state = await readState(webContents);
  while (Date.now() < deadline && state.input === undefined) {
    throwForAction(state);
    await delay(POLL_INTERVAL_MS);
    state = await readState(webContents);
  }
  throwForAction(state);
  input.onProgress?.('ready', Date.now() - startedAt);

  const mode = input.operation === 'image' ? state.imageMode : state.videoMode;
  if (mode === undefined) throw new Error(`Grok Imagine did not expose the ${input.operation === 'image' ? 'image' : 'video'} mode.`);
  if (!mode.selected) {
    clickAt(webContents, mode.rectangle);
    await delay(400);
  }
  input.onProgress?.('configuring', Date.now() - startedAt);

  state = await readState(webContents);
  if (input.operation !== 'image') {
    if (input.durationSeconds !== undefined) await selectMenuText(webContents, state.durationButton?.rectangle, `${input.durationSeconds}s`);
    await selectMenuText(webContents, (await readState(webContents)).aspectButton?.rectangle, input.aspectRatio);
    await selectMenuText(webContents, (await readState(webContents)).resolutionButton?.rectangle, '480p');
  } else {
    await selectMenuText(webContents, state.aspectButton?.rectangle, input.aspectRatio);
  }

  if (input.referenceImage !== undefined) {
    input.onProgress?.('uploading', Date.now() - startedAt);
    const uploadButton = await webContents.executeJavaScript(`(() => { const b = [...document.querySelectorAll('button')].find((e) => e.getAttribute('aria-label') === 'Tải lên' || e.getAttribute('aria-label') === 'Upload'); if (!b) return false; b.click(); return true; })()`, true) as boolean;
    if (!uploadButton) throw new Error('Grok Imagine did not expose its upload control.');
    await injectImageFile(webContents, input.referenceImage);
  }

  state = await fillPrompt(webContents, input.prompt, deadline);
  const existingImages = new Set(state.images.map((entry) => entry.src));
  const existingVideos = new Set(state.videos.map((entry) => entry.src));
  clickAt(webContents, state.submit!);
  input.onProgress?.('submitted', Date.now() - startedAt);
  let lastHeartbeat = 0;
  while (Date.now() < deadline) {
    await delay(POLL_INTERVAL_MS);
    state = await readState(webContents);
    throwForAction(state);
    const elapsed = Date.now() - startedAt;
    if (elapsed - lastHeartbeat >= 10_000) { lastHeartbeat = elapsed; input.onProgress?.('generating', elapsed); }
    const generated = (input.operation === 'image' ? state.images : state.videos).find((entry) => !(input.operation === 'image' ? existingImages : existingVideos).has(entry.src));
    if (generated !== undefined) { input.onProgress?.('downloading', elapsed); return generated.src; }
  }
  throw new Error('Grok Imagine did not produce media before the timeout. Check account access, credits, and the prompt, then retry.');
}
