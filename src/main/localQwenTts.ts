import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { access, open, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';
import { randomUUID } from 'node:crypto';

const TOKENS = ['{modelPath}', '{voiceSamplePath}', '{textPath}', '{outputPath}', '{language}'] as const;
type Config = { executablePath: string; modelPath: string; voiceSamplePath: string; workingDirectory: string; args: string[] };

function configPath(): string {
  const path = process.env.VIDEO_TOOL_TTS_CONFIG_PATH;
  if (!path || !isAbsolute(path)) throw new Error('Qwen TTS needs an absolute VIDEO_TOOL_TTS_CONFIG_PATH pointing to a local JSON config. See docs/local-qwen-tts.md.');
  return path;
}

async function readConfig(): Promise<Config> {
  let value: unknown;
  try { value = JSON.parse(await readFile(configPath(), 'utf8')) as unknown; }
  catch { throw new Error('Qwen TTS config could not be read as JSON. Check VIDEO_TOOL_TTS_CONFIG_PATH.'); }
  if (typeof value !== 'object' || value === null) throw new Error('Qwen TTS config must be a JSON object.');
  const config = value as Partial<Config>;
  for (const key of ['executablePath', 'modelPath', 'voiceSamplePath', 'workingDirectory'] as const) {
    if (typeof config[key] !== 'string' || !isAbsolute(config[key])) throw new Error(`Qwen TTS config ${key} must be an absolute path.`);
  }
  if (!Array.isArray(config.args) || !config.args.every((arg) => typeof arg === 'string') || !config.args.some((arg) => arg.includes('{textPath}')) || !config.args.some((arg) => arg.includes('{outputPath}')) || !config.args.some((arg) => arg.includes('{voiceSamplePath}'))) {
    throw new Error('Qwen TTS config args must include {textPath}, {outputPath}, and {voiceSamplePath}.');
  }
  for (const arg of config.args) {
    for (const token of arg.match(/\{[^{}]+\}/gu) ?? []) if (!(TOKENS as readonly string[]).includes(token)) throw new Error(`Unknown Qwen TTS argument token: ${token}`);
  }
  const resolved = config as Config;
  await access(resolved.executablePath, constants.X_OK);
  await access(resolved.modelPath, constants.R_OK);
  await access(resolved.voiceSamplePath, constants.R_OK);
  if (!(await stat(resolved.workingDirectory)).isDirectory()) throw new Error('Qwen TTS workingDirectory must be a directory.');
  if (!(await stat(resolved.voiceSamplePath)).isFile()) throw new Error('Qwen TTS voiceSamplePath must be an authorized audio file.');
  return resolved;
}

export async function generateLocalQwenSpeech(input: { script: string; outputPath: string; language?: string }): Promise<void> {
  const config = await readConfig();
  const textPath = join(dirname(input.outputPath), `.openscene-qwen-text-${randomUUID()}.txt`);
  const replacements: Record<string, string> = {
    '{modelPath}': config.modelPath,
    '{voiceSamplePath}': config.voiceSamplePath,
    '{textPath}': textPath,
    '{outputPath}': input.outputPath,
    '{language}': input.language?.trim() || 'Auto'
  };
  const args = config.args.map((arg) => arg.replace(/\{[^{}]+\}/gu, (token) => replacements[token] ?? token));
  await writeFile(textPath, input.script, { flag: 'wx', mode: 0o600 });
  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(config.executablePath, args, { cwd: config.workingDirectory, shell: false, stdio: 'ignore', windowsHide: true });
      const timeout = setTimeout(() => child.kill(), 10 * 60_000);
      child.once('error', (error) => { clearTimeout(timeout); reject(error); });
      child.once('close', (code) => { clearTimeout(timeout); code === 0 ? resolve() : reject(new Error(`Qwen TTS wrapper exited with code ${code ?? 'unknown'}.`)); });
    });
    const result = await stat(input.outputPath);
    if (!result.isFile() || result.size < 44 || result.size > 512 * 1024 * 1024) throw new Error('Qwen TTS did not produce a valid-sized WAV file.');
    const file = await open(input.outputPath, 'r');
    try {
      const header = Buffer.alloc(12);
      await file.read(header, 0, header.length, 0);
      if (header.toString('ascii', 0, 4) !== 'RIFF' || header.toString('ascii', 8, 12) !== 'WAVE') throw new Error('Qwen TTS output must be a WAV file.');
    } finally { await file.close(); }
  } finally {
    await unlink(textPath).catch(() => undefined);
  }
}
