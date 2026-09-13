import { createWriteStream } from 'node:fs';
import { mkdir, rm, stat } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { WriteStream } from 'node:fs';

import type { ChunkAck, RecordingResult, RecordingSession } from '../shared/models';
import { isInsideDirectory } from './projectStoreSupport';

interface ActiveRecording {
  session: RecordingSession;
  stream: WriteStream;
  nextSequence: number;
  totalBytes: number;
}

export interface BeginRecordingInput {
  sourceId: string;
  sourceName: string;
  now?: Date;
}

export function sanitizeFileSegment(value: string): string {
  const segment = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);

  return segment.length > 0 ? segment : 'window';
}

export function createRecordingFileName(sourceName: string, now: Date): string {
  const timestamp = now.toISOString().replace(/[:.]/g, '-');
  return `${timestamp}-${sanitizeFileSegment(sourceName)}.webm`;
}

function streamFinished(stream: WriteStream): Promise<void> {
  return new Promise((resolveFinished, rejectFinished) => {
    stream.once('finish', resolveFinished);
    stream.once('error', rejectFinished);
    stream.end();
  });
}

function waitForDrain(stream: WriteStream): Promise<void> {
  return new Promise((resolveDrain, rejectDrain) => {
    stream.once('drain', resolveDrain);
    stream.once('error', rejectDrain);
  });
}

function destroyStream(stream: WriteStream): Promise<void> {
  if (stream.closed) {
    stream.destroy();
    return Promise.resolve();
  }
  return new Promise((resolveClosed) => {
    stream.once('close', resolveClosed);
    stream.destroy();
  });
}

export class RecordingFileStore {
  private readonly activeRecordings = new Map<string, ActiveRecording>();
  private readonly completedRecordings = new Map<string, RecordingResult>();

  constructor(private readonly recordingsDirectory: string) {}

  get directory(): string {
    return this.recordingsDirectory;
  }

  async begin(input: BeginRecordingInput): Promise<RecordingSession> {
    await mkdir(this.recordingsDirectory, { recursive: true });

    const now = input.now ?? new Date();
    const sessionId = randomUUID();
    const outputPath = join(this.recordingsDirectory, createRecordingFileName(input.sourceName, now));
    if (!isInsideDirectory(this.recordingsDirectory, outputPath)) {
      throw new Error('Resolved recording path escaped the recordings directory.');
    }

    const stream = createWriteStream(outputPath, { flags: 'wx' });
    const session: RecordingSession = {
      id: sessionId,
      sourceId: input.sourceId,
      sourceName: input.sourceName,
      status: 'recording',
      startedAt: now.toISOString(),
      outputPath
    };

    this.activeRecordings.set(sessionId, {
      session,
      stream,
      nextSequence: 0,
      totalBytes: 0
    });

    return session;
  }

  async appendChunk(sessionId: string, sequence: number, chunk: ArrayBuffer): Promise<ChunkAck> {
    const activeRecording = this.activeRecordings.get(sessionId);
    if (activeRecording === undefined) {
      throw new Error('Recording session is not active.');
    }

    if (sequence !== activeRecording.nextSequence) {
      throw new Error(`Unexpected recording chunk sequence ${sequence}; expected ${activeRecording.nextSequence}.`);
    }

    const bytes = Buffer.from(new Uint8Array(chunk));
    if (bytes.byteLength === 0) {
      activeRecording.nextSequence += 1;
      return { sequence, totalBytes: activeRecording.totalBytes };
    }

    const canContinue = activeRecording.stream.write(bytes);
    if (!canContinue) {
      await waitForDrain(activeRecording.stream);
    }

    activeRecording.nextSequence += 1;
    activeRecording.totalBytes += bytes.byteLength;
    return { sequence, totalBytes: activeRecording.totalBytes };
  }

  async finalize(sessionId: string, durationMs: number, now = new Date()): Promise<RecordingResult> {
    const activeRecording = this.activeRecordings.get(sessionId);
    if (activeRecording === undefined) {
      throw new Error('Recording session is not active.');
    }

    this.activeRecordings.delete(sessionId);
    await streamFinished(activeRecording.stream);

    const fileStats = await stat(activeRecording.session.outputPath);
    const result: RecordingResult = {
      sessionId,
      outputPath: activeRecording.session.outputPath,
      fileName: basename(activeRecording.session.outputPath),
      directory: dirname(activeRecording.session.outputPath),
      fileSizeBytes: fileStats.size,
      durationMs,
      createdAt: now.toISOString()
    };

    this.completedRecordings.set(sessionId, result);
    return result;
  }

  async abort(sessionId: string): Promise<void> {
    const activeRecording = this.activeRecordings.get(sessionId);
    if (activeRecording === undefined) {
      return;
    }

    this.activeRecordings.delete(sessionId);
    // A WriteStream can still be opening when the user cancels. Removing its
    // path before the handle closes races with that pending open on Windows:
    // the remove succeeds, then the stream creates an empty file afterward.
    await destroyStream(activeRecording.stream);
    await rm(activeRecording.session.outputPath, { force: true });
  }

  getResult(sessionId: string): RecordingResult | null {
    return this.completedRecordings.get(sessionId) ?? null;
  }

  getActiveSession(sessionId: string): RecordingSession | null {
    return this.activeRecordings.get(sessionId)?.session ?? null;
  }
}
