import {
  TIMELINE_VALIDATION_LIMITS,
  getFiniteNonNegative,
  getOpaqueId,
  getTrimmedString,
  hasAllowedKeys,
  isPlainRecord,
  isUnknownArray
} from './timelineValidationPrimitives';
import { VIDEO_OPERATIONS } from './mediaCapabilityRegistry';

export const AI_PROJECT_SCHEMA_VERSION = 1 as const;

export const SCRIPT_SOURCE_KINDS = ['idea', 'content', 'rewrite'] as const;
export const SCRIPT_STATUSES = ['draft', 'approved', 'superseded'] as const;
export const REFERENCE_ASSET_ROLES = [
  'character',
  'style',
  'product',
  'location',
  'start_frame',
  'end_frame',
  'driving_video'
] as const;
export const GENERATION_CAPABILITIES = VIDEO_OPERATIONS;
export const GENERATION_STATUSES = ['draft', 'queued', 'running', 'needs_user_action', 'completed', 'failed', 'cancelled'] as const;
export const PROVENANCE_SOURCES = ['user', 'provider', 'import', 'local_model'] as const;

export type ScriptSourceKind = (typeof SCRIPT_SOURCE_KINDS)[number];
export type ScriptStatus = (typeof SCRIPT_STATUSES)[number];
export type ReferenceAssetRole = (typeof REFERENCE_ASSET_ROLES)[number];
export type GenerationCapability = (typeof GENERATION_CAPABILITIES)[number];
export type AiGenerationStatus = (typeof GENERATION_STATUSES)[number];
export type ProvenanceSource = (typeof PROVENANCE_SOURCES)[number];

export type ScriptVersion = {
  readonly id: string;
  readonly title: string;
  readonly sourceKind: ScriptSourceKind;
  readonly sourceText: string;
  readonly screenplay: string;
  readonly status: ScriptStatus;
  readonly createdAt: string;
  readonly parentVersionId?: string;
};

export type CharacterProfile = {
  readonly id: string;
  readonly name: string;
  readonly invariantDescription: string;
  readonly referenceAssetIds: readonly string[];
};

export type StyleBible = {
  readonly palette: readonly string[];
  readonly lighting: string;
  readonly cameraGrammar: string;
  readonly texture: string;
  readonly forbiddenChanges: readonly string[];
};

export type AiScene = {
  readonly id: string;
  readonly scriptVersionId: string;
  readonly order: number;
  readonly title: string;
  readonly objective: string;
  readonly setting: string;
  readonly timeOfDay: string;
  readonly characterIds: readonly string[];
  readonly shotIds: readonly string[];
  readonly continuityNotes: string;
};

export type AiShot = {
  readonly id: string;
  readonly sceneId: string;
  readonly order: number;
  readonly durationMs: number;
  readonly framing: string;
  readonly cameraMotion: string;
  readonly action: string;
  readonly dialogue: string;
  readonly audioCues: readonly string[];
  readonly negativePrompt: string;
  readonly referenceAssetIds: readonly string[];
  readonly generationIds: readonly string[];
};

export type ReferenceAsset = {
  readonly id: string;
  readonly assetId: string;
  readonly role: ReferenceAssetRole;
  readonly label: string;
};

export type GenerationRecord = {
  readonly id: string;
  readonly shotId: string;
  readonly providerId: string;
  readonly modelId: string;
  readonly capability: GenerationCapability;
  readonly status: AiGenerationStatus;
  readonly prompt: string;
  readonly referenceAssetIds: readonly string[];
  readonly outputAssetIds: readonly string[];
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly provenanceId?: string;
  readonly error?: string;
  readonly estimatedCostUsd?: number;
};

export type ProvenanceRecord = {
  readonly id: string;
  readonly source: ProvenanceSource;
  readonly createdAt: string;
  readonly inputAssetIds: readonly string[];
  readonly outputAssetIds: readonly string[];
  readonly transformHistory: readonly string[];
  readonly providerId?: string;
  readonly modelId?: string;
  readonly rightsNote?: string;
};

export type AiProjectDocument = {
  readonly schemaVersion: typeof AI_PROJECT_SCHEMA_VERSION;
  readonly scripts: readonly ScriptVersion[];
  readonly scenes: readonly AiScene[];
  readonly shots: readonly AiShot[];
  readonly characters: readonly CharacterProfile[];
  readonly styleBible: StyleBible;
  readonly referenceAssets: readonly ReferenceAsset[];
  readonly generations: readonly GenerationRecord[];
  readonly provenance: readonly ProvenanceRecord[];
};

export type SaveAiProjectDocumentInput = {
  readonly projectId: string;
  readonly ai: AiProjectDocument;
};

const LIMITS = {
  scripts: 100,
  scenes: 2_000,
  shots: 10_000,
  characters: 500,
  references: 5_000,
  generations: 50_000,
  provenance: 50_000,
  relations: 2_000,
  shortText: 500,
  mediumText: 10_000,
  longText: 200_000,
  listText: 200,
  durationMs: 120_000
} as const;

const EMPTY_STYLE_BIBLE: StyleBible = {
  palette: [],
  lighting: '',
  cameraGrammar: '',
  texture: '',
  forbiddenChanges: []
};

export function createEmptyAiProjectDocument(): AiProjectDocument {
  return {
    schemaVersion: AI_PROJECT_SCHEMA_VERSION,
    scripts: [],
    scenes: [],
    shots: [],
    characters: [],
    styleBible: { ...EMPTY_STYLE_BIBLE },
    referenceAssets: [],
    generations: [],
    provenance: []
  };
}

/**
 * Detaches a project asset without leaving the AI planning graph unreadable.
 * Authored scripts, scenes, shots, generation attempts and provenance history
 * remain; only relations to the removed bytes are pruned.
 */
export function removeAssetFromAiProjectDocument(document: AiProjectDocument, assetId: string): AiProjectDocument {
  const removedReferenceIds = new Set(
    document.referenceAssets.filter((reference) => reference.assetId === assetId).map((reference) => reference.id)
  );
  const keepReference = (referenceId: string): boolean => !removedReferenceIds.has(referenceId);
  const keepAsset = (candidateAssetId: string): boolean => candidateAssetId !== assetId;
  return {
    ...document,
    characters: document.characters.map((character) => ({
      ...character,
      referenceAssetIds: character.referenceAssetIds.filter(keepReference)
    })),
    shots: document.shots.map((shot) => ({
      ...shot,
      referenceAssetIds: shot.referenceAssetIds.filter(keepReference)
    })),
    referenceAssets: document.referenceAssets.filter((reference) => reference.assetId !== assetId),
    generations: document.generations.map((generation) => ({
      ...generation,
      referenceAssetIds: generation.referenceAssetIds.filter(keepReference),
      outputAssetIds: generation.outputAssetIds.filter(keepAsset)
    })),
    provenance: document.provenance.map((record) => ({
      ...record,
      inputAssetIds: record.inputAssetIds.filter(keepAsset),
      outputAssetIds: record.outputAssetIds.filter(keepAsset)
    }))
  };
}

function getIsoTimestamp(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  if (typeof value !== 'string') return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) || parsed.toISOString() !== value ? null : value;
}

function getText(record: Record<string, unknown>, key: string, maxLength: number, allowEmpty = true): string | null {
  const value = record[key];
  if (typeof value !== 'string' || value.length > maxLength) return null;
  const trimmed = value.trim();
  return allowEmpty || trimmed.length > 0 ? trimmed : null;
}

function getOptionalText(record: Record<string, unknown>, key: string, maxLength: number): string | undefined | null {
  return record[key] === undefined ? undefined : getText(record, key, maxLength, false);
}

function getEnum<T extends string>(record: Record<string, unknown>, key: string, values: readonly T[]): T | null {
  const value = record[key];
  return typeof value === 'string' && values.includes(value as T) ? value as T : null;
}

function getBoundedInteger(record: Record<string, unknown>, key: string, max: number): number | null {
  const value = getFiniteNonNegative(record, key);
  return value !== null && Number.isSafeInteger(value) && value <= max ? value : null;
}

function getUniqueIdList(value: unknown): readonly string[] | null {
  if (!isUnknownArray(value) || value.length > LIMITS.relations) return null;
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    const id = getOpaqueId({ id: entry }, 'id');
    if (id === null || seen.has(id)) return null;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

function getStringList(value: unknown): readonly string[] | null {
  if (!isUnknownArray(value) || value.length > LIMITS.listText) return null;
  const output: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string' || entry.length > LIMITS.shortText) return null;
    const trimmed = entry.trim();
    if (trimmed.length === 0) return null;
    output.push(trimmed);
  }
  return output;
}

function parseCollection<T>(value: unknown, max: number, parser: (entry: unknown) => T | null): T[] | null {
  if (!isUnknownArray(value) || value.length > max) return null;
  const output: T[] = [];
  for (const entry of value) {
    const parsed = parser(entry);
    if (parsed === null) return null;
    output.push(parsed);
  }
  return output;
}

function parseScript(value: unknown): ScriptVersion | null {
  if (!isPlainRecord(value) || !hasAllowedKeys(value, ['id', 'title', 'sourceKind', 'sourceText', 'screenplay', 'status', 'createdAt', 'parentVersionId'])) return null;
  const id = getOpaqueId(value, 'id');
  const title = getTrimmedString(value, 'title', LIMITS.shortText);
  const sourceKind = getEnum(value, 'sourceKind', SCRIPT_SOURCE_KINDS);
  const sourceText = getText(value, 'sourceText', LIMITS.longText);
  const screenplay = getText(value, 'screenplay', LIMITS.longText);
  const status = getEnum(value, 'status', SCRIPT_STATUSES);
  const createdAt = getIsoTimestamp(value, 'createdAt');
  const parentVersionId = value.parentVersionId === undefined ? undefined : getOpaqueId(value, 'parentVersionId');
  if (id === null || title === null || sourceKind === null || sourceText === null || screenplay === null || status === null || createdAt === null || parentVersionId === null) return null;
  return { id, title, sourceKind, sourceText, screenplay, status, createdAt, ...(parentVersionId === undefined ? {} : { parentVersionId }) };
}

function parseCharacter(value: unknown): CharacterProfile | null {
  if (!isPlainRecord(value) || !hasAllowedKeys(value, ['id', 'name', 'invariantDescription', 'referenceAssetIds'])) return null;
  const id = getOpaqueId(value, 'id');
  const name = getTrimmedString(value, 'name', LIMITS.shortText);
  const invariantDescription = getText(value, 'invariantDescription', LIMITS.mediumText);
  const referenceAssetIds = getUniqueIdList(value.referenceAssetIds);
  return id === null || name === null || invariantDescription === null || referenceAssetIds === null
    ? null
    : { id, name, invariantDescription, referenceAssetIds };
}

function parseStyleBible(value: unknown): StyleBible | null {
  if (!isPlainRecord(value) || !hasAllowedKeys(value, ['palette', 'lighting', 'cameraGrammar', 'texture', 'forbiddenChanges'])) return null;
  const palette = getStringList(value.palette);
  const lighting = getText(value, 'lighting', LIMITS.mediumText);
  const cameraGrammar = getText(value, 'cameraGrammar', LIMITS.mediumText);
  const texture = getText(value, 'texture', LIMITS.mediumText);
  const forbiddenChanges = getStringList(value.forbiddenChanges);
  return palette === null || lighting === null || cameraGrammar === null || texture === null || forbiddenChanges === null
    ? null
    : { palette, lighting, cameraGrammar, texture, forbiddenChanges };
}

function parseScene(value: unknown): AiScene | null {
  if (!isPlainRecord(value) || !hasAllowedKeys(value, ['id', 'scriptVersionId', 'order', 'title', 'objective', 'setting', 'timeOfDay', 'characterIds', 'shotIds', 'continuityNotes'])) return null;
  const id = getOpaqueId(value, 'id');
  const scriptVersionId = getOpaqueId(value, 'scriptVersionId');
  const order = getBoundedInteger(value, 'order', LIMITS.scenes);
  const title = getTrimmedString(value, 'title', LIMITS.shortText);
  const objective = getText(value, 'objective', LIMITS.mediumText);
  const setting = getText(value, 'setting', LIMITS.mediumText);
  const timeOfDay = getText(value, 'timeOfDay', LIMITS.shortText);
  const characterIds = getUniqueIdList(value.characterIds);
  const shotIds = getUniqueIdList(value.shotIds);
  const continuityNotes = getText(value, 'continuityNotes', LIMITS.mediumText);
  if (id === null || scriptVersionId === null || order === null || title === null || objective === null || setting === null || timeOfDay === null || characterIds === null || shotIds === null || continuityNotes === null) return null;
  return { id, scriptVersionId, order, title, objective, setting, timeOfDay, characterIds, shotIds, continuityNotes };
}

function parseShot(value: unknown): AiShot | null {
  if (!isPlainRecord(value) || !hasAllowedKeys(value, ['id', 'sceneId', 'order', 'durationMs', 'framing', 'cameraMotion', 'action', 'dialogue', 'audioCues', 'negativePrompt', 'referenceAssetIds', 'generationIds'])) return null;
  const id = getOpaqueId(value, 'id');
  const sceneId = getOpaqueId(value, 'sceneId');
  const order = getBoundedInteger(value, 'order', LIMITS.shots);
  const durationMs = getBoundedInteger(value, 'durationMs', LIMITS.durationMs);
  const framing = getText(value, 'framing', LIMITS.shortText);
  const cameraMotion = getText(value, 'cameraMotion', LIMITS.shortText);
  const action = getText(value, 'action', LIMITS.mediumText);
  const dialogue = getText(value, 'dialogue', LIMITS.mediumText);
  const audioCues = getStringList(value.audioCues);
  const negativePrompt = getText(value, 'negativePrompt', LIMITS.mediumText);
  const referenceAssetIds = getUniqueIdList(value.referenceAssetIds);
  const generationIds = getUniqueIdList(value.generationIds);
  if (id === null || sceneId === null || order === null || durationMs === null || durationMs === 0 || framing === null || cameraMotion === null || action === null || dialogue === null || audioCues === null || negativePrompt === null || referenceAssetIds === null || generationIds === null) return null;
  return { id, sceneId, order, durationMs, framing, cameraMotion, action, dialogue, audioCues, negativePrompt, referenceAssetIds, generationIds };
}

function parseReferenceAsset(value: unknown): ReferenceAsset | null {
  if (!isPlainRecord(value) || !hasAllowedKeys(value, ['id', 'assetId', 'role', 'label'])) return null;
  const id = getOpaqueId(value, 'id');
  const assetId = getOpaqueId(value, 'assetId');
  const role = getEnum(value, 'role', REFERENCE_ASSET_ROLES);
  const label = getTrimmedString(value, 'label', LIMITS.shortText);
  return id === null || assetId === null || role === null || label === null ? null : { id, assetId, role, label };
}

function parseGeneration(value: unknown): GenerationRecord | null {
  if (!isPlainRecord(value) || !hasAllowedKeys(value, ['id', 'shotId', 'providerId', 'modelId', 'capability', 'status', 'prompt', 'referenceAssetIds', 'outputAssetIds', 'createdAt', 'updatedAt', 'provenanceId', 'error', 'estimatedCostUsd'])) return null;
  const id = getOpaqueId(value, 'id');
  const shotId = getOpaqueId(value, 'shotId');
  const providerId = getText(value, 'providerId', LIMITS.shortText, false);
  const modelId = getText(value, 'modelId', LIMITS.shortText, false);
  const capability = getEnum(value, 'capability', GENERATION_CAPABILITIES);
  const status = getEnum(value, 'status', GENERATION_STATUSES);
  const prompt = getText(value, 'prompt', LIMITS.longText);
  const referenceAssetIds = getUniqueIdList(value.referenceAssetIds);
  const outputAssetIds = getUniqueIdList(value.outputAssetIds);
  const createdAt = getIsoTimestamp(value, 'createdAt');
  const updatedAt = getIsoTimestamp(value, 'updatedAt');
  const provenanceId = value.provenanceId === undefined ? undefined : getOpaqueId(value, 'provenanceId');
  const error = getOptionalText(value, 'error', LIMITS.mediumText);
  const estimatedCostUsd = value.estimatedCostUsd === undefined ? undefined : getFiniteNonNegative(value, 'estimatedCostUsd');
  if (id === null || shotId === null || providerId === null || modelId === null || capability === null || status === null || prompt === null || referenceAssetIds === null || outputAssetIds === null || createdAt === null || updatedAt === null || provenanceId === null || error === null || estimatedCostUsd === null || (estimatedCostUsd !== undefined && (!Number.isFinite(estimatedCostUsd) || estimatedCostUsd > 1_000_000))) return null;
  return { id, shotId, providerId, modelId, capability, status, prompt, referenceAssetIds, outputAssetIds, createdAt, updatedAt, ...(provenanceId === undefined ? {} : { provenanceId }), ...(error === undefined ? {} : { error }), ...(estimatedCostUsd === undefined ? {} : { estimatedCostUsd }) };
}

function parseProvenance(value: unknown): ProvenanceRecord | null {
  if (!isPlainRecord(value) || !hasAllowedKeys(value, ['id', 'source', 'createdAt', 'inputAssetIds', 'outputAssetIds', 'transformHistory', 'providerId', 'modelId', 'rightsNote'])) return null;
  const id = getOpaqueId(value, 'id');
  const source = getEnum(value, 'source', PROVENANCE_SOURCES);
  const createdAt = getIsoTimestamp(value, 'createdAt');
  const inputAssetIds = getUniqueIdList(value.inputAssetIds);
  const outputAssetIds = getUniqueIdList(value.outputAssetIds);
  const transformHistory = getStringList(value.transformHistory);
  const providerId = getOptionalText(value, 'providerId', LIMITS.shortText);
  const modelId = getOptionalText(value, 'modelId', LIMITS.shortText);
  const rightsNote = getOptionalText(value, 'rightsNote', LIMITS.mediumText);
  if (id === null || source === null || createdAt === null || inputAssetIds === null || outputAssetIds === null || transformHistory === null || providerId === null || modelId === null || rightsNote === null) return null;
  return { id, source, createdAt, inputAssetIds, outputAssetIds, transformHistory, ...(providerId === undefined ? {} : { providerId }), ...(modelId === undefined ? {} : { modelId }), ...(rightsNote === undefined ? {} : { rightsNote }) };
}

function uniqueById<T extends { readonly id: string }>(items: readonly T[]): Map<string, T> | null {
  const map = new Map<string, T>();
  for (const item of items) {
    if (map.has(item.id)) return null;
    map.set(item.id, item);
  }
  return map;
}

function sameIds(actual: readonly string[], expected: readonly string[]): boolean {
  return actual.length === expected.length && actual.every((id) => expected.includes(id));
}

function relationsAreValid(document: AiProjectDocument, availableAssetIds?: ReadonlySet<string>): boolean {
  const scripts = uniqueById(document.scripts);
  const scenes = uniqueById(document.scenes);
  const shots = uniqueById(document.shots);
  const characters = uniqueById(document.characters);
  const references = uniqueById(document.referenceAssets);
  const generations = uniqueById(document.generations);
  const provenance = uniqueById(document.provenance);
  if (scripts === null || scenes === null || shots === null || characters === null || references === null || generations === null || provenance === null) return false;

  for (const script of document.scripts) {
    let cursor: ScriptVersion | undefined = script;
    const visited = new Set<string>();
    while (cursor?.parentVersionId !== undefined) {
      if (visited.has(cursor.id)) return false;
      visited.add(cursor.id);
      cursor = scripts.get(cursor.parentVersionId);
      if (cursor === undefined) return false;
    }
  }

  const sceneOrders = new Set<string>();
  for (const scene of document.scenes) {
    if (!scripts.has(scene.scriptVersionId) || scene.characterIds.some((id) => !characters.has(id))) return false;
    if (sceneOrders.has(`${scene.scriptVersionId}:${scene.order}`)) return false;
    sceneOrders.add(`${scene.scriptVersionId}:${scene.order}`);
    const expectedShots = document.shots.filter((shot) => shot.sceneId === scene.id).map((shot) => shot.id);
    if (!sameIds(scene.shotIds, expectedShots)) return false;
  }

  const shotOrders = new Set<string>();
  for (const shot of document.shots) {
    if (!scenes.has(shot.sceneId) || shot.referenceAssetIds.some((id) => !references.has(id))) return false;
    if (shotOrders.has(`${shot.sceneId}:${shot.order}`)) return false;
    shotOrders.add(`${shot.sceneId}:${shot.order}`);
    const expectedGenerations = document.generations.filter((generation) => generation.shotId === shot.id).map((generation) => generation.id);
    if (!sameIds(shot.generationIds, expectedGenerations)) return false;
  }

  if (document.characters.some((character) => character.referenceAssetIds.some((id) => !references.has(id)))) return false;
  if (document.generations.some((generation) =>
    !shots.has(generation.shotId) ||
    generation.referenceAssetIds.some((id) => !references.has(id)) ||
    (generation.provenanceId !== undefined && !provenance.has(generation.provenanceId)))) return false;

  if (availableAssetIds !== undefined) {
    if (document.referenceAssets.some((reference) => !availableAssetIds.has(reference.assetId))) return false;
    if (document.generations.some((generation) => generation.outputAssetIds.some((id) => !availableAssetIds.has(id)))) return false;
    if (document.provenance.some((record) => [...record.inputAssetIds, ...record.outputAssetIds].some((id) => !availableAssetIds.has(id)))) return false;
  }
  return true;
}

export function parseAiProjectDocument(value: unknown, availableAssetIds?: ReadonlySet<string>): AiProjectDocument | null {
  if (!isPlainRecord(value) || !hasAllowedKeys(value, ['schemaVersion', 'scripts', 'scenes', 'shots', 'characters', 'styleBible', 'referenceAssets', 'generations', 'provenance']) || value.schemaVersion !== AI_PROJECT_SCHEMA_VERSION) return null;
  const scripts = parseCollection(value.scripts, LIMITS.scripts, parseScript);
  const scenes = parseCollection(value.scenes, LIMITS.scenes, parseScene);
  const shots = parseCollection(value.shots, LIMITS.shots, parseShot);
  const characters = parseCollection(value.characters, LIMITS.characters, parseCharacter);
  const styleBible = parseStyleBible(value.styleBible);
  const referenceAssets = parseCollection(value.referenceAssets, LIMITS.references, parseReferenceAsset);
  const generations = parseCollection(value.generations, LIMITS.generations, parseGeneration);
  const provenance = parseCollection(value.provenance, LIMITS.provenance, parseProvenance);
  if (scripts === null || scenes === null || shots === null || characters === null || styleBible === null || referenceAssets === null || generations === null || provenance === null) return null;
  const document: AiProjectDocument = {
    schemaVersion: AI_PROJECT_SCHEMA_VERSION,
    scripts: scripts.sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id)),
    scenes: scenes.sort((left, right) => left.scriptVersionId.localeCompare(right.scriptVersionId) || left.order - right.order || left.id.localeCompare(right.id)),
    shots: shots.sort((left, right) => left.sceneId.localeCompare(right.sceneId) || left.order - right.order || left.id.localeCompare(right.id)),
    characters: characters.sort((left, right) => left.id.localeCompare(right.id)),
    styleBible,
    referenceAssets: referenceAssets.sort((left, right) => left.id.localeCompare(right.id)),
    generations: generations.sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id)),
    provenance: provenance.sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id))
  };
  return relationsAreValid(document, availableAssetIds) ? document : null;
}

export function parseSaveAiProjectDocumentInput(value: unknown): SaveAiProjectDocumentInput | null {
  if (!isPlainRecord(value) || !hasAllowedKeys(value, ['projectId', 'ai'])) return null;
  const projectId = getOpaqueId(value, 'projectId');
  const ai = parseAiProjectDocument(value.ai);
  return projectId === null || ai === null ? null : { projectId, ai };
}
