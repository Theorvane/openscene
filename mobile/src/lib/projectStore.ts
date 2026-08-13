import { Directory, File, Paths } from 'expo-file-system';

import { parseTimelineDocument } from '@openvideo/shared/timelineDocumentValidators';
import { resolveTimelineTrackForAsset, trackAppendStartMs } from '@openvideo/shared/timelineClipPlacement';
import { placeClip } from '@openvideo/shared/timelineClipLogic';
import { isStill, stillClipSource } from '@openvideo/shared/timelineStills';

import { createInitialTimeline } from '@openvideo/shared/timelineLogic';
import { DEFAULT_CLIP_EFFECTS, PROJECT_SCHEMA_VERSION, type TimelineDocument } from '@openvideo/shared/timelineTypes';

/**
 * Projects live inside the app's own storage.
 *
 * The desktop is folder-backed because a desktop user has a filesystem they
 * think in. A phone user does not, and a document they have to file away
 * themselves is not how a phone app behaves — so the app owns the directory and
 * the user owns the project.
 *
 * Layout, one directory per project:
 *   projects/<id>/project.json   the snapshot
 *   projects/<id>/media/<file>   imported media, copied in
 */

const ROOT = new Directory(Paths.document, 'projects');

/**
 * Where an asset came from.
 *
 * Optional, because every project written before this existed has assets with
 * no origin and they are still perfectly good clips. Absent reads as imported.
 * A generated one carries what made it: the library is the only place the user
 * ever sees the prompt again, and a still with no prompt beside it is a picture
 * they cannot ask for a variation of.
 */
export type AssetOrigin = {
  readonly kind: 'generated';
  readonly modelId: string;
  readonly prompt: string;
  readonly at: string;
};

export type MobileAsset = {
  readonly id: string;
  readonly displayName: string;
  /**
   * `image` cannot go on a timeline — the tracks are video and audio, and the
   * shared placement rules have nowhere to put a still. It is here because the
   * project is where a generated image has to live to survive the screen that
   * made it, and the library is what gives it somewhere to be seen.
   */
  readonly kind: 'video' | 'audio' | 'image';
  readonly mimeType: string;
  /** Relative to the project directory, so the record survives a reinstall path change. */
  readonly relativePath: string;
  readonly durationMs: number;
  readonly width: number;
  readonly height: number;
  readonly origin?: AssetOrigin;
};

/** A still is a picture with no length of its own; see `timelineStills`. */
export function isStillAsset(asset: MobileAsset): boolean {
  return isStill(asset.kind);
}

export type MobileProject = {
  readonly schemaVersion: typeof PROJECT_SCHEMA_VERSION;
  readonly id: string;
  readonly name: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly assets: readonly MobileAsset[];
  readonly timeline: TimelineDocument;
};

export type ProjectSummary = { readonly id: string; readonly name: string; readonly updatedAt: string };

function ensureRoot(): void {
  if (!ROOT.exists) ROOT.create({ intermediates: true });
}

function projectDir(id: string): Directory {
  return new Directory(ROOT, id);
}

function projectFile(id: string): File {
  return new File(projectDir(id), 'project.json');
}

/** The project's media directory, for callers that write assets themselves. */
export function projectMediaDir(projectId: string): Directory {
  return new Directory(projectDir(projectId), 'media');
}

/** Absolute URI for a stored asset, resolved at read time rather than persisted. */
export function assetUri(projectId: string, asset: MobileAsset): string {
  return new File(projectDir(projectId), asset.relativePath).uri;
}

export function listProjects(): readonly ProjectSummary[] {
  ensureRoot();
  const summaries: ProjectSummary[] = [];
  for (const entry of ROOT.list()) {
    if (!(entry instanceof Directory)) continue;
    const project = readProject(entry.name);
    if (project !== null) summaries.push({ id: project.id, name: project.name, updatedAt: project.updatedAt });
  }
  // Most recently touched first: the project a user wants is almost always the
  // one they were last in.
  return summaries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** First record per id wins; a repeat is the same file recorded twice. */
function dedupeAssets(assets: readonly MobileAsset[]): readonly MobileAsset[] {
  const seen = new Set<string>();
  return assets.filter((asset) => {
    if (seen.has(asset.id)) return false;
    seen.add(asset.id);
    return true;
  });
}

export function readProject(id: string): MobileProject | null {
  const file = projectFile(id);
  if (!file.exists) return null;
  try {
    const parsed: unknown = JSON.parse(file.textSync());
    const candidate = parsed as Partial<MobileProject>;
    // The timeline goes through the shared validator rather than being trusted:
    // a file edited or truncated between sessions must not become a document the
    // editing rules then operate on.
    const timeline = parseTimelineDocument(candidate.timeline);
    if (timeline === null || typeof candidate.id !== 'string' || typeof candidate.name !== 'string') return null;
    return {
      schemaVersion: PROJECT_SCHEMA_VERSION,
      id: candidate.id,
      name: candidate.name,
      createdAt: candidate.createdAt ?? new Date().toISOString(),
      updatedAt: candidate.updatedAt ?? new Date().toISOString(),
      // Deduplicated on the way in: projects written before the placement bug
      // was fixed hold the same asset twice, which renders as duplicate keys and
      // counts double against the library. The first record wins.
      assets: dedupeAssets(Array.isArray(candidate.assets) ? (candidate.assets as MobileAsset[]) : []),
      timeline
    };
  } catch {
    // An unreadable project is reported as absent rather than crashing the list;
    // one broken file must not hide every other project.
    return null;
  }
}

export function createProject(name: string): MobileProject {
  ensureRoot();
  const id = `project-${Date.now().toString(36)}`;
  const dir = projectDir(id);
  dir.create({ intermediates: true });
  new Directory(dir, 'media').create({ intermediates: true });
  const now = new Date().toISOString();
  const project: MobileProject = {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id,
    name: name.trim().length > 0 ? name.trim() : 'Untitled',
    createdAt: now,
    updatedAt: now,
    assets: [],
    timeline: createInitialTimeline()
  };
  writeProject(project);
  return project;
}

export function writeProject(project: MobileProject): void {
  ensureRoot();
  const dir = projectDir(project.id);
  if (!dir.exists) dir.create({ intermediates: true });
  projectFile(project.id).write(JSON.stringify({ ...project, updatedAt: new Date().toISOString() }));
}

export function renameProject(id: string, name: string): MobileProject | null {
  const project = readProject(id);
  if (project === null || name.trim().length === 0) return null;
  const renamed = { ...project, name: name.trim() };
  writeProject(renamed);
  return renamed;
}

export function deleteProject(id: string): void {
  const dir = projectDir(id);
  // Deletes only inside the app's own projects directory — never a path the user
  // chose, which is the rule the desktop follows for the same reason.
  if (dir.exists) dir.delete();
}

/**
 * Copies picked media into the project.
 *
 * A photo-library URI is not a stable reference: the asset can be deleted or the
 * permission revoked, and a project that silently loses a clip between sessions
 * is worse than one that costs a copy.
 */
/**
 * Writes a generated still into the project and records it.
 *
 * Generated images used to be shown and then dropped: leaving the Image tab, or
 * the assistant's thread scrolling on, lost a picture the user had paid for. The
 * bytes arrive as base64 from the adapter and go straight to a file — holding a
 * megabyte of it in the project record would put it through `JSON.parse` on
 * every read of the project.
 */
export function saveGeneratedImage(
  projectId: string,
  image: {
    readonly base64: string;
    readonly mimeType: string;
    readonly prompt: string;
    readonly modelId: string;
  }
): MobileAsset | null {
  const project = readProject(projectId);
  if (project === null) return null;

  const dir = new Directory(projectDir(projectId), 'media');
  if (!dir.exists) dir.create({ intermediates: true });
  const id = `asset-${Date.now().toString(36)}`;
  const extension = image.mimeType === 'image/jpeg' ? 'jpg' : 'png';
  const relativePath = `media/${id}.${extension}`;
  new File(projectDir(projectId), relativePath).write(image.base64, { encoding: 'base64' });

  const asset: MobileAsset = {
    id,
    displayName: `${image.modelId} still`,
    kind: 'image',
    mimeType: image.mimeType,
    relativePath,
    durationMs: 0,
    width: 0,
    height: 0,
    origin: { kind: 'generated', modelId: image.modelId, prompt: image.prompt, at: new Date().toISOString() }
  };
  writeProject({ ...project, assets: [...project.assets, asset] });
  return asset;
}

export function importAsset(
  projectId: string,
  source: { readonly uri: string; readonly displayName: string; readonly mimeType: string; readonly durationMs: number; readonly width: number; readonly height: number; readonly kind: 'video' | 'audio' }
): MobileAsset & { readonly kind: 'video' | 'audio' } {
  const dir = new Directory(projectDir(projectId), 'media');
  if (!dir.exists) dir.create({ intermediates: true });
  const id = `asset-${Date.now().toString(36)}`;
  const extension = source.displayName.includes('.') ? source.displayName.split('.').pop() : 'mp4';
  const relativePath = `media/${id}.${extension ?? 'mp4'}`;
  new File(source.uri).copy(new File(projectDir(projectId), relativePath));
  return {
    id,
    displayName: source.displayName,
    kind: source.kind,
    mimeType: source.mimeType,
    relativePath,
    durationMs: source.durationMs,
    width: source.width,
    height: source.height
  };
}

/**
 * Appends a stored asset to the project's timeline and saves it.
 *
 * Generated shots arrive one at a time and have to land somewhere the user can
 * see them. They are appended rather than placed at their planned start: the
 * plan's timing assumes every shot succeeds, and leaving a gap where a failed
 * shot would have gone silently changes the cut.
 */
export function appendAssetToTimeline(project: MobileProject, asset: MobileAsset): MobileProject | null {
  // Placement only reads the asset's kind, but the shared signature takes the
  // whole record, so the stored asset is widened rather than partially faked.
  const target = resolveTimelineTrackForAsset(project.timeline, {
    id: asset.id,
    displayName: asset.displayName,
    kind: asset.kind,
    mimeType: asset.mimeType,
    byteLength: 0,
    projectRelativePath: asset.relativePath,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    metadata: { durationMs: asset.durationMs, width: asset.width, height: asset.height }
  });
  if (!target.ok) return null;
  const next = placeClip(project.timeline, {
    trackId: target.track.id,
    clip: {
      // Unique per placement, the way the editor's own placements are. Deriving
      // the clip id from the asset alone meant putting the same asset on the
      // timeline twice produced two clips answering to one id — and the editor
      // selects, splits, trims and deletes by that id.
      id: `clip-${asset.id}-${Date.now().toString(36)}`,
      assetId: asset.id,
      timelineStartMs: trackAppendStartMs(target.track),
      // A still has no duration to take a length from, so the shared rule
      // supplies the hold — and makes the clip's source as long as the hold, so
      // the ordinary "a clip may not run past its source" check is satisfied.
      ...(isStillAsset(asset)
        ? stillClipSource()
        : { sourceStartMs: 0, sourceEndMs: asset.durationMs, sourceDurationMs: asset.durationMs }),
      effects: { ...DEFAULT_CLIP_EFFECTS },
      keyframes: []
    }
  });
  if (next === null) return null;
  // The asset may already be in the project — the library places one that is
  // certainly there, and adding it a second time put two records under one id.
  // React rendered them as duplicate keys and the duplicate went to disk.
  const known = project.assets.some((entry) => entry.id === asset.id);
  const updated: MobileProject = {
    ...project,
    assets: known ? project.assets : [...project.assets, asset],
    timeline: next
  };
  writeProject(updated);
  return updated;
}

/** Bytes on disk for a stored asset, or null when the file has gone missing. */
export function assetByteLength(projectId: string, asset: MobileAsset): number | null {
  const file = new File(projectDir(projectId), asset.relativePath);
  return file.exists ? file.size ?? null : null;
}

/**
 * Removes an asset, its file, and every clip that referenced it.
 *
 * Leaving the clips behind would point the timeline at a file that is gone, and
 * an export would fail at the last step instead of the moment the user asked for
 * this. The file removed is always inside the app's own project directory.
 */
export function deleteAsset(projectId: string, assetId: string): MobileProject | null {
  const project = readProject(projectId);
  if (project === null) return null;
  const asset = project.assets.find((candidate) => candidate.id === assetId);
  if (asset === undefined) return null;

  const file = new File(projectDir(projectId), asset.relativePath);
  if (file.exists) file.delete();

  const updated: MobileProject = {
    ...project,
    assets: project.assets.filter((candidate) => candidate.id !== assetId),
    timeline: {
      ...project.timeline,
      tracks: project.timeline.tracks.map((track) => ({
        ...track,
        clips: track.clips.filter((clip) => clip.assetId !== assetId)
      }))
    }
  };
  writeProject(updated);
  return updated;
}
