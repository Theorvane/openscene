import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, open, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  COMFYUI_MOTION_NODE_TITLES,
  compileComfyUiMotionWorkflow,
  inspectComfyUiMotionWorkflow,
  parseComfyUiApiWorkflow
} from '../src/shared/comfyUiMotion';
import { generateComfyUiMotionVideo, getComfyUiMotionWorkerStatus, resolveComfyUiMotionConfiguration } from '../src/main/comfyUiMotionAdapter';

const workflow = {
  '1': { class_type: 'LoadImage', inputs: { image: 'old.png' }, _meta: { title: COMFYUI_MOTION_NODE_TITLES.characterImage } },
  '2': { class_type: 'VHS_LoadVideo', inputs: { video: 'old.mp4' }, _meta: { title: COMFYUI_MOTION_NODE_TITLES.drivingVideo } },
  '3': { class_type: 'CLIPTextEncode', inputs: { text: 'old prompt' }, _meta: { title: COMFYUI_MOTION_NODE_TITLES.prompt } },
  '4': { class_type: 'VHS_VideoCombine', inputs: { images: ['3', 0] }, _meta: { title: COMFYUI_MOTION_NODE_TITLES.output } }
};

describe('ComfyUI Motion Control workflow contract', () => {
  it('accepts API format and patches only stable titled inputs', () => {
    const parsed = parseComfyUiApiWorkflow({ prompt: workflow });
    const compiled = compileComfyUiMotionWorkflow({
      workflow: parsed,
      characterImageName: 'openscene/job/character.png',
      drivingVideoName: 'openscene/job/driving.mp4',
      prompt: 'subtle performance'
    });

    expect(compiled.prompt['1']?.inputs.image).toBe('openscene/job/character.png');
    expect(compiled.prompt['2']?.inputs.video).toBe('openscene/job/driving.mp4');
    expect(compiled.prompt['3']?.inputs.text).toBe('subtle performance');
    expect(compiled.prompt['4']).toEqual(workflow['4']);
    expect(compiled.summary.outputNodeId).toBe('4');
    expect(workflow['1'].inputs.image).toBe('old.png');
  });

  it('refuses browser graph exports and ambiguous markers', () => {
    expect(() => parseComfyUiApiWorkflow({ nodes: [] })).toThrow(/API format/);
    const duplicate = parseComfyUiApiWorkflow({
      ...workflow,
      '5': { class_type: 'LoadImage', inputs: { image: 'other.png' }, _meta: { title: COMFYUI_MOTION_NODE_TITLES.characterImage } }
    });
    expect(() => inspectComfyUiMotionWorkflow(duplicate)).toThrow(/more than one/);
  });

  it('allows plain HTTP only for loopback workers and never accepts credentials in the URL', () => {
    expect(resolveComfyUiMotionConfiguration({ OPENSCENE_COMFYUI_BASE_URL: 'http://127.0.0.1:8188' }).safeEndpoint).toBe('http://127.0.0.1:8188');
    expect(resolveComfyUiMotionConfiguration({ OPENSCENE_COMFYUI_BASE_URL: 'https://worker.example' }).safeEndpoint).toBe('https://worker.example');
    expect(() => resolveComfyUiMotionConfiguration({ OPENSCENE_COMFYUI_BASE_URL: 'http://worker.example' })).toThrow(/HTTPS/);
    expect(() => resolveComfyUiMotionConfiguration({ OPENSCENE_COMFYUI_BASE_URL: 'https://token@worker.example' })).toThrow(/scheme, host, and port/);
  });

  it('reports unconfigured without contacting the default worker', async () => {
    const fetchImpl = vi.fn();
    await expect(getComfyUiMotionWorkerStatus({ environment: {}, fetchImpl: fetchImpl as unknown as typeof fetch })).resolves.toMatchObject({
      state: 'unconfigured', endpoint: 'http://127.0.0.1:8188', modes: { move: { configured: false }, mix: { configured: false } }
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('checks nodes, uploads both sources, polls, and atomically saves the MP4', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'openscene-comfy-test-'));
    const workflowPath = join(directory, 'move.json');
    const drivingPath = join(directory, 'driving.mp4');
    const outputPath = join(directory, 'output.mp4');
    const outputBytes = Buffer.from('generated-video');
    try {
      await writeFile(workflowPath, JSON.stringify(workflow));
      await writeFile(drivingPath, Buffer.from('driving-video'));
      const source = await open(drivingPath, 'r');
      let uploads = 0;
      const fetchImpl = vi.fn(async (url: string | URL, init?: RequestInit) => {
        const parsed = new URL(String(url));
        if (parsed.pathname === '/system_stats') return new Response(JSON.stringify({ system: { comfyui_version: '1.2.3' }, devices: [{ name: 'GPU', vram_total: 24 * 1024 ** 3, vram_free: 20 * 1024 ** 3 }] }));
        if (parsed.pathname === '/object_info') return new Response(JSON.stringify(Object.fromEntries(['LoadImage', 'VHS_LoadVideo', 'CLIPTextEncode', 'VHS_VideoCombine'].map((name) => [name, {}]))));
        if (parsed.pathname === '/upload/image') {
          expect(init?.method).toBe('POST');
          uploads += 1;
          return new Response(JSON.stringify({ name: uploads === 1 ? 'character.png' : 'driving.mp4', subfolder: 'openscene/test' }));
        }
        if (parsed.pathname === '/prompt') {
          const body = JSON.parse(init?.body as string);
          expect(body.prompt['1'].inputs.image).toContain('character.png');
          expect(body.prompt['2'].inputs.video).toContain('driving.mp4');
          return new Response(JSON.stringify({ prompt_id: 'prompt-1' }));
        }
        if (parsed.pathname === '/history/prompt-1') return new Response(JSON.stringify({ 'prompt-1': { outputs: { '4': { videos: [{ filename: 'result.mp4', subfolder: 'final', type: 'output' }] } } } }));
        if (parsed.pathname === '/view') return new Response(outputBytes, { headers: { 'content-length': String(outputBytes.byteLength) } });
        return new Response('not found', { status: 404 });
      });

      const generated = await generateComfyUiMotionVideo({
        mode: 'move', prompt: 'perform',
        characterImage: { displayName: 'person.png', mimeType: 'image/png', base64: Buffer.from('image').toString('base64') },
        drivingVideo: { file: source, filePath: drivingPath, byteLength: 13, durationMs: 4_000, mimeType: 'video/mp4' },
        outputFilePath: outputPath, pollIntervalMs: 0,
        environment: { OPENSCENE_COMFYUI_BASE_URL: 'http://127.0.0.1:8188', OPENSCENE_COMFYUI_WAN_MOVE_WORKFLOW_PATH: workflowPath },
        fetchImpl: fetchImpl as unknown as typeof fetch
      });

      expect(generated).toEqual({ providerJobId: 'prompt-1', outputFilePath: outputPath });
      expect(await readFile(outputPath)).toEqual(outputBytes);
      expect(uploads).toBe(2);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
