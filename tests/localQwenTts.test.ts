import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateLocalQwenSpeech } from '../src/main/localQwenTts';

const originalConfig = process.env.VIDEO_TOOL_TTS_CONFIG_PATH;
afterEach(() => {
  if (originalConfig === undefined) delete process.env.VIDEO_TOOL_TTS_CONFIG_PATH;
  else process.env.VIDEO_TOOL_TTS_CONFIG_PATH = originalConfig;
});

describe('local Qwen TTS wrapper', () => {
  it('fails clearly when the wrapper is not configured', async () => {
    delete process.env.VIDEO_TOOL_TTS_CONFIG_PATH;
    await expect(generateLocalQwenSpeech({ script: 'Hello', outputPath: join(tmpdir(), 'unused.wav') }))
      .rejects.toThrow('VIDEO_TOOL_TTS_CONFIG_PATH');
  });

  it('passes script and authorized sample as file paths and verifies WAV output', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'openscene-qwen-test-'));
    try {
      const model = join(dir, 'model');
      const sample = join(dir, 'sample.wav');
      const wrapper = join(dir, 'wrapper.cjs');
      const config = join(dir, 'config.json');
      const output = join(dir, 'result.wav');
      await writeFile(model, 'model');
      await writeFile(sample, 'authorized sample');
      await writeFile(wrapper, `const fs = require('node:fs'); const [text, out, sample] = process.argv.slice(2); if (fs.readFileSync(text, 'utf8') !== 'Narration') process.exit(2); if (fs.readFileSync(sample, 'utf8') !== 'authorized sample') process.exit(3); const wav = Buffer.alloc(46); wav.write('RIFF', 0); wav.write('WAVE', 8); fs.writeFileSync(out, wav);`);
      await writeFile(config, JSON.stringify({ executablePath: process.execPath, modelPath: model, voiceSamplePath: sample, workingDirectory: dir, args: [wrapper, '{textPath}', '{outputPath}', '{voiceSamplePath}'] }));
      process.env.VIDEO_TOOL_TTS_CONFIG_PATH = config;
      await generateLocalQwenSpeech({ script: 'Narration', outputPath: output });
      expect((await readFile(output)).toString('ascii', 0, 4)).toBe('RIFF');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
