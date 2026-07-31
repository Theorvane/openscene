import { chmod, mkdir, readdir, rm, stat } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

import { createInitialTimeline } from '../shared/timelineLogic';
import { PROJECT_SCHEMA_VERSION } from '../shared/timelineTypes';
import type {
  CreateProjectInput,
  LocalProjectSnapshot,
  LocalProjectSummary,
  MediaAsset,
  TimelineDocument,
  UpdateAssetMetadataInput
} from '../shared/timelineTypes';
import { parseCreateProjectInput, parseTimelineDocument, parseUpdateAssetMetadataInput } from '../shared/timelineValidators';
import { assertAssetImportQuota, DEFAULT_ASSET_IMPORT_LIMITS, type AssetImportLimits } from './assetImportPolicy';
import {
  PROJECT_FILE_NAME,
  ProjectStoreError,
  isOpaqueId,
  projectDirectory,
  readProjectSnapshotAtDirectory,
  writeProjectSnapshotAtDirectory
} from './projectStoreSupport';
import type { ProjectLocationRegistry } from './projectLocations';
import { findInvalidAssetRelation, parsePersistedProject, type InvalidAssetRelation } from './projectSnapshotCodec';

const projectMutationGates = new Map<string, Promise<void>>();

type RegisterAssetsInput = {
  readonly projectId: string;
  readonly assets: readonly MediaAsset[];
  readonly limits: AssetImportLimits;
};

function invalidAssetRelationMessage(relation: InvalidAssetRelation): string {
  switch (relation.reason) {
    case 'unavailable':
      return `Timeline clip ${relation.clipId} references an unavailable ${relation.trackKind} asset.`;
    case 'metadata_missing':
      return `Timeline clip ${relation.clipId} requires known asset metadata.`;
    case 'duration_mismatch':
      return `Timeline clip ${relation.clipId} has inconsistent asset duration.`;
    case 'bounds_exceeded':
      return `Timeline clip ${relation.clipId} exceeds its asset duration.`;
  }
}

const PROJECT_FOLDER_NAME_FALLBACK = 'OpenScene Project';

function sanitizeFolderName(name: string): string {
  const sanitized = name.replace(/[\\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim();
  return sanitized.length > 0 ? sanitized.slice(0, 80) : PROJECT_FOLDER_NAME_FALLBACK;
}

export type CreateProjectInFolderInput = {
  readonly name: string;
  readonly parentDirectory: string;
};

export type OpenOrInitializeFolderResult = {
  readonly project: LocalProjectSnapshot;
  readonly created: boolean;
};

export class ProjectStore {
  private readonly rootDirectory: string;
  private readonly locations: ProjectLocationRegistry | null;

  constructor(rootDirectory: string, locations: ProjectLocationRegistry | null = null) {
    this.rootDirectory = resolve(rootDirectory);
    this.locations = locations;
  }

  /** Absolute directory a project works in: its registered real folder, or the internal root slot. */
  async resolveDirectory(projectId: string): Promise<string> {
    const external = await this.locations?.get(projectId) ?? null;
    return external ?? projectDirectory(this.rootDirectory, projectId);
  }

  /**
   * Create a project inside a real, user-chosen parent folder: a new
   * `<parent>/<project name>` directory receives project.json (and later the
   * assets/ copies), and the location is registered so every subsequent
   * operation works in that folder.
   */
  async createInFolder(input: CreateProjectInFolderInput, now = new Date()): Promise<LocalProjectSnapshot> {
    if (this.locations === null) {
      throw new ProjectStoreError('Folder-backed projects are not configured.');
    }
    const parsedInput = parseCreateProjectInput({ name: input.name });
    if (parsedInput === null) {
      throw new ProjectStoreError('Invalid project creation input.');
    }
    const parentDirectory = resolve(input.parentDirectory);
    const baseFolderName = sanitizeFolderName(parsedInput.name);
    const id = randomUUID();
    const timestamp = now.toISOString();
    const snapshot: LocalProjectSnapshot = {
      schemaVersion: PROJECT_SCHEMA_VERSION,
      id,
      name: parsedInput.name,
      createdAt: timestamp,
      updatedAt: timestamp,
      assets: [],
      timeline: createInitialTimeline()
    };

    let directory: string | null = null;
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const candidate = join(parentDirectory, attempt === 0 ? baseFolderName : `${baseFolderName} ${attempt + 1}`);
      try {
        await mkdir(candidate);
        directory = candidate;
        break;
      } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'EEXIST') continue;
        throw error;
      }
    }
    if (directory === null) {
      throw new ProjectStoreError('A project folder could not be created inside the selected directory.');
    }

    try {
      await writeProjectSnapshotAtDirectory(directory, snapshot);
      await this.locations.register(id, directory);
      return snapshot;
    } catch (error) {
      await rm(directory, { recursive: true, force: true });
      await this.locations.unregister(id).catch(() => undefined);
      throw error;
    }
  }

  /** Open a user-picked folder that already contains a project.json and register its location. */
  async openFromFolder(directory: string): Promise<LocalProjectSnapshot | null> {
    if (this.locations === null) {
      throw new ProjectStoreError('Folder-backed projects are not configured.');
    }
    const resolved = resolve(directory);
    const snapshot = await readProjectSnapshotAtDirectory(resolved, null);
    if (snapshot === null) {
      return null;
    }
    await this.locations.register(snapshot.id, resolved);
    return snapshot;
  }

  /**
   * Single-picker flow: a folder with a readable project opens it, and any
   * folder without a project.json becomes a new project named after the
   * folder itself — its existing files are left untouched; only project.json
   * is written. A folder whose project.json exists but cannot be read is
   * rejected so a real (possibly newer or corrupt) project is never
   * overwritten.
   */
  async openOrInitializeFolder(directory: string, now = new Date()): Promise<OpenOrInitializeFolderResult | null> {
    if (this.locations === null) {
      throw new ProjectStoreError('Folder-backed projects are not configured.');
    }
    const resolved = resolve(directory);
    const existing = await readProjectSnapshotAtDirectory(resolved, null);
    if (existing !== null) {
      await this.locations.register(existing.id, resolved);
      return { project: existing, created: false };
    }
    const hasProjectFile = await stat(join(resolved, PROJECT_FILE_NAME)).then(() => true).catch(() => false);
    if (hasProjectFile) {
      return null;
    }
    const id = randomUUID();
    const timestamp = now.toISOString();
    const snapshot: LocalProjectSnapshot = {
      schemaVersion: PROJECT_SCHEMA_VERSION,
      id,
      name: sanitizeFolderName(basename(resolved)),
      createdAt: timestamp,
      updatedAt: timestamp,
      assets: [],
      timeline: createInitialTimeline()
    };
    try {
      await writeProjectSnapshotAtDirectory(resolved, snapshot);
      await this.locations.register(id, resolved);
      return { project: snapshot, created: true };
    } catch (error) {
      // The folder belongs to the user: roll back only the file we wrote.
      await rm(join(resolved, PROJECT_FILE_NAME), { force: true }).catch(() => undefined);
      await this.locations.unregister(id).catch(() => undefined);
      throw error;
    }
  }

  async create(input: CreateProjectInput, now = new Date()): Promise<LocalProjectSnapshot> {
    const parsedInput = parseCreateProjectInput(input);
    if (parsedInput === null) {
      throw new ProjectStoreError('Invalid project creation input.');
    }
    await this.ensureRoot();
    const id = randomUUID();
    const directory = projectDirectory(this.rootDirectory, id);
    const timestamp = now.toISOString();
    const snapshot: LocalProjectSnapshot = {
      schemaVersion: PROJECT_SCHEMA_VERSION,
      id,
      name: parsedInput.name,
      createdAt: timestamp,
      updatedAt: timestamp,
      assets: [],
      timeline: createInitialTimeline()
    };
    await mkdir(directory, { mode: 0o700 });
    try {
      await writeProjectSnapshotAtDirectory(directory, snapshot);
      return snapshot;
    } catch (error) {
      await rm(directory, { recursive: true, force: true });
      throw error;
    }
  }

  async list(): Promise<readonly LocalProjectSummary[]> {
    await this.ensureRoot();
    const externalLocations = await this.locations?.entries() ?? new Map<string, string>();
    const entries = await readdir(this.rootDirectory, { withFileTypes: true });
    const internalSnapshots = await Promise.all(
      entries
        .filter((entry) => entry.isDirectory() && isOpaqueId(entry.name) && !externalLocations.has(entry.name))
        .map((entry) => readProjectSnapshotAtDirectory(projectDirectory(this.rootDirectory, entry.name), entry.name))
    );
    const externalSnapshots = await Promise.all(
      [...externalLocations.entries()].map(async ([projectId, directory]) => {
        const snapshot = await readProjectSnapshotAtDirectory(directory, projectId);
        return snapshot === null ? null : { snapshot, directory };
      })
    );
    const internalSummaries = internalSnapshots
      .filter((snapshot): snapshot is LocalProjectSnapshot => snapshot !== null)
      .map(({ id, name, createdAt, updatedAt }): LocalProjectSummary => ({ id, name, createdAt, updatedAt, storage: 'internal' }));
    const externalSummaries = externalSnapshots
      .filter((entry): entry is { snapshot: LocalProjectSnapshot; directory: string } => entry !== null)
      .map(({ snapshot: { id, name, createdAt, updatedAt }, directory }): LocalProjectSummary => ({
        id,
        name,
        createdAt,
        updatedAt,
        storage: 'external',
        folderName: basename(directory)
      }));
    return [...internalSummaries, ...externalSummaries]
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id));
  }

  async open(projectId: string): Promise<LocalProjectSnapshot | null> {
    return readProjectSnapshotAtDirectory(await this.resolveDirectory(projectId), projectId);
  }

  /**
   * Renames a project. The folder on disk is untouched: an external project
   * lives where the user put it, and renaming its directory would move their
   * files out from under them.
   */
  async rename(projectId: string, name: string, now = new Date()): Promise<LocalProjectSnapshot> {
    const parsed = parseCreateProjectInput({ name });
    if (parsed === null) {
      throw new ProjectStoreError('A project name is required.');
    }
    return this.mutateProject(projectId, async () => {
      const current = await this.requireProject(projectId);
      return this.persist({ ...current, name: parsed.name, updatedAt: now.toISOString() });
    });
  }

  async saveTimeline(projectId: string, timeline: TimelineDocument, now = new Date()): Promise<LocalProjectSnapshot> {
    const parsedTimeline = parseTimelineDocument(timeline);
    if (parsedTimeline === null) {
      throw new ProjectStoreError('Invalid timeline document.');
    }
    return this.mutateProject(projectId, async () => {
      const current = await this.requireProject(projectId);
      const invalidRelation = findInvalidAssetRelation(parsedTimeline, current.assets);
      if (invalidRelation !== null) {
        throw new ProjectStoreError(invalidAssetRelationMessage(invalidRelation));
      }
      return this.persist({ ...current, updatedAt: now.toISOString(), timeline: parsedTimeline });
    });
  }

  async registerAsset(projectId: string, asset: MediaAsset, now = new Date()): Promise<MediaAsset> {
    const registered = await this.registerAssets(
      { projectId, assets: [asset], limits: DEFAULT_ASSET_IMPORT_LIMITS },
      now
    );
    const firstAsset = registered[0];
    if (firstAsset === undefined) {
      throw new ProjectStoreError('Asset registration produced no asset.');
    }
    return firstAsset;
  }

  async registerAssets(input: RegisterAssetsInput, now = new Date()): Promise<readonly MediaAsset[]> {
    return this.mutateProject(input.projectId, async () => {
      const current = await this.requireProject(input.projectId);
      const incomingIds = new Set(input.assets.map((asset) => asset.id));
      if (incomingIds.size !== input.assets.length || current.assets.some((asset) => incomingIds.has(asset.id))) {
        throw new ProjectStoreError('Asset registration contains a duplicate asset id.');
      }
      assertAssetImportQuota(
        {
          selectedFileBytes: input.assets.map((asset) => asset.byteLength),
          existingProjectBytes: current.assets.reduce((total, asset) => total + asset.byteLength, 0)
        },
        input.limits
      );
      await this.persist({ ...current, updatedAt: now.toISOString(), assets: [...current.assets, ...input.assets] });
      return input.assets;
    });
  }

  async updateAssetMetadata(input: UpdateAssetMetadataInput, now = new Date()): Promise<MediaAsset> {
    const parsedInput = parseUpdateAssetMetadataInput(input);
    if (parsedInput === null) {
      throw new ProjectStoreError('Invalid asset metadata input.');
    }
    return this.mutateProject(parsedInput.projectId, async () => {
      const current = await this.requireProject(parsedInput.projectId);
      const asset = current.assets.find((candidate) => candidate.id === parsedInput.assetId);
      if (asset === undefined) {
        throw new ProjectStoreError(`Asset ${parsedInput.assetId} was not found.`);
      }
      const timestamp = now.toISOString();
      const updatedAsset: MediaAsset = {
        ...asset,
        metadata: {
          durationMs: parsedInput.durationMs,
          ...('width' in parsedInput ? { width: parsedInput.width } : {}),
          ...('height' in parsedInput ? { height: parsedInput.height } : {})
        },
        updatedAt: timestamp
      };
      const assets = current.assets.map((candidate) => candidate.id === updatedAsset.id ? updatedAsset : candidate);
      await this.persist({ ...current, updatedAt: timestamp, assets });
      return updatedAsset;
    });
  }

  async getAsset(projectId: string, assetId: string): Promise<MediaAsset | null> {
    const project = await this.open(projectId);
    return project?.assets.find((asset) => asset.id === assetId) ?? null;
  }

  async delete(projectId: string): Promise<boolean> {
    return this.mutateProject(projectId, async () => {
      const externalDirectory = await this.locations?.get(projectId) ?? null;
      if (externalDirectory !== null) {
        // The project lives in the user's real folder: never delete their
        // files recursively — only forget the location.
        return await this.locations?.unregister(projectId) ?? false;
      }
      const current = await this.open(projectId);
      if (current === null) {
        return false;
      }
      await rm(projectDirectory(this.rootDirectory, current.id), { recursive: true });
      return true;
    });
  }

  private async requireProject(projectId: string): Promise<LocalProjectSnapshot> {
    const project = await this.open(projectId);
    if (project === null) {
      throw new ProjectStoreError(`Project ${projectId} was not found.`);
    }
    return project;
  }

  private async persist(snapshot: LocalProjectSnapshot): Promise<LocalProjectSnapshot> {
    const parsed = parsePersistedProject(snapshot, snapshot.id);
    if (parsed === null) {
      throw new ProjectStoreError('Invalid project snapshot.');
    }
    await writeProjectSnapshotAtDirectory(await this.resolveDirectory(parsed.id), parsed);
    return parsed;
  }

  private async ensureRoot(): Promise<void> {
    await mkdir(this.rootDirectory, { recursive: true, mode: 0o700 });
    await chmod(this.rootDirectory, 0o700);
  }

  private async mutateProject<T>(projectId: string, operation: () => Promise<T>): Promise<T> {
    assertOpaqueIdForMutation(projectId);
    const mutationKey = `${this.rootDirectory}::${projectId}`;
    const previousMutation = projectMutationGates.get(mutationKey) ?? Promise.resolve();
    let releaseMutation = (): void => undefined;
    const currentMutation = new Promise<void>((resolveMutation) => {
      releaseMutation = resolveMutation;
    });
    projectMutationGates.set(mutationKey, currentMutation);
    await previousMutation;
    try {
      return await operation();
    } finally {
      releaseMutation();
      if (projectMutationGates.get(mutationKey) === currentMutation) {
        projectMutationGates.delete(mutationKey);
      }
    }
  }
}

function assertOpaqueIdForMutation(projectId: string): void {
  if (!isOpaqueId(projectId)) {
    throw new ProjectStoreError('Invalid project id.');
  }
}
