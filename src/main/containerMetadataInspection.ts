import { spawn } from 'node:child_process';

import {
  personalMetadataFieldsForKeys,
  type MetadataTagInventory
} from '../shared/metadataPrivacy';
import { ffprobePathFor } from './exportMeasurement';

const PROBE_TIMEOUT_MS = 15_000;
const MAXIMUM_PROBE_OUTPUT_BYTES = 1024 * 1024;

export type InspectContainerMetadataInput = {
  readonly ffmpegPath: string;
  readonly filePath: string;
};

export function containerMetadataProbeArgs(filePath: string): readonly string[] {
  return [
    '-v',
    'error',
    '-show_entries',
    'format_tags:stream_tags',
    '-of',
    'json',
    filePath
  ];
}

function tagKeys(value: unknown): readonly string[] | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const tags = (value as { tags?: unknown }).tags;
  if (tags === undefined) return [];
  return typeof tags === 'object' && tags !== null && !Array.isArray(tags) ? Object.keys(tags) : null;
}

/** Parses names only and immediately discards every tag value returned by FFprobe. */
export function parseContainerMetadataProbeOutput(stdout: string): MetadataTagInventory | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
  const record = parsed as { format?: unknown; streams?: unknown };
  const hasFormat = typeof record.format === 'object' && record.format !== null && !Array.isArray(record.format);
  const hasStreams = Array.isArray(record.streams);
  if (!hasFormat && !hasStreams) return null;
  if (record.format !== undefined && !hasFormat) return null;
  if (record.streams !== undefined && !hasStreams) return null;
  const formatKeys = hasFormat ? tagKeys(record.format) : [];
  const streamKeys = hasStreams
    ? (record.streams as readonly unknown[]).map(tagKeys)
    : [];
  if (formatKeys === null || streamKeys.some((keys) => keys === null)) return null;
  const keys = [
    ...formatKeys,
    ...streamKeys.flatMap((entry) => entry ?? [])
  ];
  return { checked: true, fields: personalMetadataFieldsForKeys(keys) };
}

/** Null raw results become an unchecked, path-free inventory. */
export async function inspectContainerMetadata(input: InspectContainerMetadataInput): Promise<MetadataTagInventory> {
  const probePath = ffprobePathFor(input.ffmpegPath);
  return new Promise<MetadataTagInventory>((resolve) => {
    let settled = false;
    let stdout = '';
    const finish = (inventory: MetadataTagInventory) => {
      if (settled) return;
      settled = true;
      resolve(inventory);
    };
    const unavailable = (): MetadataTagInventory => ({ checked: false, fields: [] });
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(probePath, [...containerMetadataProbeArgs(input.filePath)], { stdio: ['ignore', 'pipe', 'ignore'] });
    } catch {
      finish(unavailable());
      return;
    }
    if (child.stdout === null) {
      child.kill();
      finish(unavailable());
      return;
    }
    child.stdout.on('data', (chunk: Buffer) => {
      if (Buffer.byteLength(stdout, 'utf8') + chunk.byteLength > MAXIMUM_PROBE_OUTPUT_BYTES) {
        child.kill();
        finish(unavailable());
        return;
      }
      stdout += chunk.toString('utf8');
    });
    const timeout = setTimeout(() => {
      child.kill();
      finish(unavailable());
    }, PROBE_TIMEOUT_MS);
    child.on('error', () => {
      clearTimeout(timeout);
      finish(unavailable());
    });
    child.on('close', (code) => {
      clearTimeout(timeout);
      finish(code === 0 ? parseContainerMetadataProbeOutput(stdout) ?? unavailable() : unavailable());
    });
  });
}
