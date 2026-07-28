import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

import { ProjectStoreError, isOpaqueId } from './projectStoreSupport';

const LOCATIONS_SCHEMA_VERSION = 1;

type PersistedLocations = {
  readonly schemaVersion: number;
  readonly locations: Readonly<Record<string, string>>;
};

function parsePersistedLocations(raw: unknown): Record<string, string> {
  if (typeof raw !== 'object' || raw === null) return {};
  const candidate = raw as Partial<PersistedLocations>;
  if (candidate.schemaVersion !== LOCATIONS_SCHEMA_VERSION) return {};
  if (typeof candidate.locations !== 'object' || candidate.locations === null) return {};

  const locations: Record<string, string> = {};
  for (const [projectId, directory] of Object.entries(candidate.locations)) {
    if (isOpaqueId(projectId) && typeof directory === 'string' && isAbsolute(directory)) {
      locations[projectId] = resolve(directory);
    }
  }
  return locations;
}

/**
 * Maps project ids to the real, user-chosen folders they live in. The registry
 * itself stays in the app's private userData directory; the registered paths
 * are only ever produced by main-process directory dialogs, never by the
 * renderer.
 */
export class ProjectLocationRegistry {
  private readonly filePath: string;
  private locations: Record<string, string> | null = null;

  constructor(filePath: string) {
    this.filePath = resolve(filePath);
  }

  async get(projectId: string): Promise<string | null> {
    const locations = await this.load();
    return locations[projectId] ?? null;
  }

  async entries(): Promise<ReadonlyMap<string, string>> {
    return new Map(Object.entries(await this.load()));
  }

  async register(projectId: string, directory: string): Promise<void> {
    if (!isOpaqueId(projectId)) {
      throw new ProjectStoreError('Invalid project id for a project location.');
    }
    if (!isAbsolute(directory)) {
      throw new ProjectStoreError('Project locations must be absolute directories.');
    }
    const locations = await this.load();
    locations[projectId] = resolve(directory);
    await this.persist(locations);
  }

  async unregister(projectId: string): Promise<boolean> {
    const locations = await this.load();
    if (locations[projectId] === undefined) return false;
    delete locations[projectId];
    await this.persist(locations);
    return true;
  }

  private async load(): Promise<Record<string, string>> {
    if (this.locations !== null) return this.locations;
    try {
      const raw: unknown = JSON.parse(await readFile(this.filePath, 'utf8'));
      this.locations = parsePersistedLocations(raw);
    } catch (error) {
      if (error instanceof SyntaxError || (error instanceof Error && 'code' in error && error.code === 'ENOENT')) {
        this.locations = {};
      } else {
        throw error;
      }
    }
    return this.locations;
  }

  private async persist(locations: Record<string, string>): Promise<void> {
    this.locations = locations;
    const payload: PersistedLocations = { schemaVersion: LOCATIONS_SCHEMA_VERSION, locations };
    await mkdir(dirname(this.filePath), { recursive: true, mode: 0o700 });
    const temporaryFile = join(dirname(this.filePath), `.project-locations.${randomUUID()}.tmp`);
    await writeFile(temporaryFile, `${JSON.stringify(payload, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    await rename(temporaryFile, this.filePath);
  }
}
