import type { AiProjectDocument, GenerationRecord, ReferenceAsset } from './aiProjectDomain';
import type { ImageAspectRatio } from './providerSeams';
import { getVideoOperationConstraints, isVideoOperationImplemented, type VideoOperation } from './mediaCapabilityRegistry';
import type { VideoContinuityControls } from './videoContinuitySettings';
import { approvedWriterShots, pipelineBaseRequest } from './writerPipeline';
import { writerVideoStyleDirection } from './writerWorkflow';
import { DEFAULT_CLIP_EFFECTS, type TimelineDocument } from './timelineTypes';
import { placeClip } from './timelineClipLogic';
import { trackAppendStartMs } from './timelineClipPlacement';

export type ProductionShotState =
  | 'not_started'
  | 'generating'
  | 'needs_import'
  | 'needs_review'
  | 'approved'
  | 'failed';

export type ProductionShotRow = {
  readonly shotId: string;
  readonly sceneId: string;
  readonly label: string;
  readonly prompt: string;
  readonly durationMs: number;
  readonly sceneTitle: string;
  readonly characterIds: readonly string[];
  readonly storyboardReference?: ReferenceAsset;
  readonly characterReferenceIds: readonly string[];
  readonly candidateCount: number;
  readonly state: ProductionShotState;
  readonly approvedGeneration?: GenerationRecord;
};

export type ProductionAssetSummary = {
  readonly id: string;
  readonly kind: 'video' | 'audio' | 'image';
  readonly durationMs: number | null;
};

export type ProductionAssemblyShot = {
  readonly shotId: string;
  readonly assetId: string;
  readonly durationMs: number;
  readonly sourceDurationMs: number;
};

export type ProductionAssemblyPlan =
  | { readonly ok: true; readonly shots: readonly ProductionAssemblyShot[]; readonly totalDurationMs: number }
  | { readonly ok: false; readonly reason: string };

export type ProductionMutationResult =
  | { readonly ok: true; readonly document: AiProjectDocument }
  | { readonly ok: false; readonly reason: string };

export type ProductionImageTarget =
  | { readonly kind: 'character_reference'; readonly characterId: string }
  | { readonly kind: 'storyboard'; readonly shotId: string };

/** Choose the shortest supported source that can fill the finished shot. Never stretch a short clip. */
export function productionSourceDurationSeconds(modelId: string, operation: VideoOperation, finishedSeconds: number, browserDurations?: readonly number[]): number | null {
  if (!Number.isFinite(finishedSeconds) || finishedSeconds <= 0) return null;
  const options = browserDurations ?? (isVideoOperationImplemented(modelId, operation)
    ? getVideoOperationConstraints(modelId, operation)?.durationSeconds
    : undefined);
  return options?.filter((seconds) => seconds >= finishedSeconds).sort((a, b) => a - b)[0] ?? null;
}

export const PRODUCTION_BATCH_LIMIT = 50;

export type ProductionImageBrief = {
  readonly target: ProductionImageTarget;
  readonly targetLabel: string;
  readonly prompt: string;
  readonly negativePrompt: string;
  readonly aspectRatio: ImageAspectRatio;
  /** Exact style label recorded with the provider job for later audit. */
  readonly stylePreset: string;
  /** Full Writer direction, separate from the editable subject prompt. */
  readonly styleDescription: string;
  readonly styleSource: 'writer' | 'fallback';
  /** Project media asset IDs for approved images to load into the provider request. */
  readonly referenceAssetIds: readonly string[];
};

/** Transient navigation state; it is deliberately not stored in the project. */
export type ProductionImageHandoff = ProductionImageBrief & {
  readonly requestId: string;
  readonly projectId: string;
};

export type ProductionImageBriefResult =
  | { readonly ok: true; readonly brief: ProductionImageBrief }
  | { readonly ok: false; readonly reason: string };

function compactParts(parts: readonly (string | undefined)[]): readonly string[] {
  return parts.map((part) => part?.trim() ?? '').filter((part) => part.length > 0);
}

function styleBiblePrompt(document: AiProjectDocument): string {
  const style = document.styleBible;
  return compactParts([
    style.palette.length > 0 ? `Palette: ${style.palette.join(', ')}.` : undefined,
    style.lighting.length > 0 ? `Lighting: ${style.lighting}.` : undefined,
    style.cameraGrammar.length > 0 ? `Camera language: ${style.cameraGrammar}.` : undefined,
    style.texture.length > 0 ? `Texture: ${style.texture}.` : undefined
  ]).join(' ');
}

export type ProductionVisualStyle = {
  readonly label: string;
  readonly description: string;
  readonly source: 'writer' | 'fallback';
};

/** One authoritative style snapshot for Image Generation and production jobs. */
export function productionVisualStyle(document: AiProjectDocument | null | undefined): ProductionVisualStyle {
  const request = pipelineBaseRequest(document?.writerPipeline);
  const writerStyle = request === null ? null : writerVideoStyleDirection(request);
  if (writerStyle !== null) {
    return { label: writerStyle.label, description: writerStyle.direction, source: 'writer' };
  }
  return {
    label: 'Cinematic',
    description: 'Cinematic production image with deliberate composition and lighting.',
    source: 'fallback'
  };
}

export function activeStyleReference(document: AiProjectDocument): ReferenceAsset | undefined {
  return document.referenceAssets.find((reference) => reference.role === 'style');
}

function characterReferencesRoundRobin(
  document: AiProjectDocument,
  referenceGroups: readonly (readonly string[])[],
  limit: number,
  excludedAssetIds: readonly string[] = []
): readonly ReferenceAsset[] {
  const referenceById = new Map(document.referenceAssets.map((reference) => [reference.id, reference]));
  const groups = referenceGroups.map((ids) => ids.flatMap((id) => {
    const reference = referenceById.get(id);
    return reference?.role === 'character' ? [reference] : [];
  }));
  const selected: ReferenceAsset[] = [];
  const seenAssets = new Set(excludedAssetIds);
  const maxDepth = Math.max(0, ...groups.map((group) => group.length));
  for (let depth = 0; depth < maxDepth && selected.length < limit; depth += 1) {
    for (const group of groups) {
      const reference = group[depth];
      if (reference === undefined || seenAssets.has(reference.assetId)) continue;
      selected.push(reference);
      seenAssets.add(reference.assetId);
      if (selected.length === limit) break;
    }
  }
  return selected;
}

function productionReferenceAssetIds(
  document: AiProjectDocument,
  characterReferenceGroups: readonly (readonly string[])[]
): readonly string[] {
  const styleAssetId = activeStyleReference(document)?.assetId;
  const remaining = styleAssetId === undefined ? 3 : 2;
  return [
    ...(styleAssetId === undefined ? [] : [styleAssetId]),
    ...characterReferencesRoundRobin(
      document,
      characterReferenceGroups,
      remaining,
      styleAssetId === undefined ? [] : [styleAssetId]
    ).map((reference) => reference.assetId)
  ];
}

export type ProductionVideoReferencePlan =
  | { readonly kind: 'storyboard'; readonly reference: ReferenceAsset }
  | { readonly kind: 'characters'; readonly references: readonly ReferenceAsset[] }
  | { readonly kind: 'text' }
  | { readonly kind: 'blocked'; readonly reason: string };

/** Chooses one honest provider input mode without silently dropping an active continuity source. */
export function planProductionVideoReferences(document: AiProjectDocument, shotId: string, input: {
  readonly controls: VideoContinuityControls;
  readonly supportsImageToVideo: boolean;
  readonly supportsReferenceToVideo: boolean;
  readonly supportsTextToVideo: boolean;
}): ProductionVideoReferencePlan {
  const shot = document.shots.find((entry) => entry.id === shotId);
  if (shot === undefined) return { kind: 'blocked', reason: 'Writer shot no longer exists.' };
  const scene = document.scenes.find((entry) => entry.id === shot.sceneId);
  if (scene === undefined) return { kind: 'blocked', reason: 'Writer scene no longer exists.' };
  const referenceById = new Map(document.referenceAssets.map((reference) => [reference.id, reference]));
  const storyboard = shot.referenceAssetIds.map((id) => referenceById.get(id))
    .find((reference) => reference?.role === 'start_frame');
  if (storyboard !== undefined) {
    return input.supportsImageToVideo
      ? { kind: 'storyboard', reference: storyboard }
      : { kind: 'blocked', reason: 'Selected model cannot use the approved storyboard first frame.' };
  }
  if (input.controls.styleConsistency && activeStyleReference(document) !== undefined) {
    return { kind: 'blocked', reason: 'Generate or attach this shot\'s storyboard first so the world/style reference is preserved in the video.' };
  }
  const characters = characterReferencesRoundRobin(document, scene.characterIds.map((characterId) =>
    document.characters.find((character) => character.id === characterId)?.referenceAssetIds ?? []
  ), 3);
  if (input.controls.characterConsistency && characters.length > 0) {
    return input.supportsReferenceToVideo
      ? { kind: 'characters', references: characters }
      : { kind: 'blocked', reason: 'Selected model cannot use the approved character references; choose a reference-video model or generate a storyboard first.' };
  }
  return input.supportsTextToVideo
    ? { kind: 'text' }
    : { kind: 'blocked', reason: 'Selected model has no usable production input mode.' };
}

export function assignStyleReference(document: AiProjectDocument, input: {
  readonly assetId: string;
  readonly referenceId: string;
  readonly label: string;
}): ProductionMutationResult {
  if (document.referenceAssets.some((reference) => reference.id === input.referenceId && reference.role !== 'style')) {
    return { ok: false, reason: 'The world/style reference id is already in use.' };
  }
  const reference: ReferenceAsset = { id: input.referenceId, assetId: input.assetId, role: 'style', label: input.label };
  return {
    ok: true,
    document: {
      ...document,
      referenceAssets: [...document.referenceAssets.filter((entry) => entry.role !== 'style'), reference]
    }
  };
}

export function clearStyleReference(document: AiProjectDocument): ProductionMutationResult {
  return {
    ok: true,
    document: { ...document, referenceAssets: document.referenceAssets.filter((entry) => entry.role !== 'style') }
  };
}

function productionNegativePrompt(document: AiProjectDocument, extra: readonly string[]): string {
  return compactParts([
    ...extra,
    ...document.styleBible.forbiddenChanges,
    'text, captions, labels, logos, watermark'
  ]).join(', ');
}

/** Creates an editable still-image brief from the approved Character Bible. */
export function buildCharacterReferenceImageBrief(
  document: AiProjectDocument,
  characterId: string
): ProductionImageBriefResult {
  const character = document.characters.find((entry) => entry.id === characterId);
  if (character === undefined) return { ok: false, reason: 'The Writer character no longer exists.' };
  if (character.referenceAssetIds.length >= 3) {
    return { ok: false, reason: `${character.name} already has the maximum of three active reference images.` };
  }
  const style = styleBiblePrompt(document);
  const visualStyle = productionVisualStyle(document);
  const styleReference = activeStyleReference(document);
  return {
    ok: true,
    brief: {
      target: { kind: 'character_reference', characterId: character.id },
      targetLabel: `Character reference for ${character.name}`,
      prompt: compactParts([
        `Create one clean production reference image for the character ${character.name}.`,
        `Preserve these invariant identity and wardrobe traits exactly: ${character.invariantDescription}.`,
        'Show one person only in a neutral full-body three-quarter pose, with the face unobstructed and the complete outfit clearly visible.',
        'Use a simple uncluttered background and even reference lighting so this image can guide later storyboard and video generations.',
        styleReference === undefined ? undefined : 'Use the first attached image only as the authoritative world/style reference for linework, palette, lighting, texture and environment design; do not copy its character identity.',
        visualStyle.description,
        style
      ]).join(' '),
      negativePrompt: productionNegativePrompt(document, [
        'extra people', 'duplicate person', 'multiple views', 'collage', 'cropped face', 'cropped body', 'occluded face'
      ]),
      aspectRatio: '3:4',
      stylePreset: visualStyle.label,
      styleDescription: visualStyle.description,
      styleSource: visualStyle.source,
      referenceAssetIds: productionReferenceAssetIds(document, [character.referenceAssetIds])
    }
  };
}

/** Creates an editable first-frame brief from one approved Writer shot. */
export function buildStoryboardImageBrief(
  document: AiProjectDocument,
  shotId: string,
  aspectRatio: ImageAspectRatio = '16:9'
): ProductionImageBriefResult {
  const shot = document.shots.find((entry) => entry.id === shotId);
  if (shot === undefined) return { ok: false, reason: 'The Writer shot no longer exists.' };
  const scene = document.scenes.find((entry) => entry.id === shot.sceneId);
  if (scene === undefined) return { ok: false, reason: 'The Writer scene no longer exists.' };
  const writerShot = approvedWriterShots(document).find((entry) => entry.id === shot.id);
  if (writerShot === undefined) return { ok: false, reason: 'Approve and save the Writer prompt stage before generating storyboard images.' };
  const sceneBlock = productionSceneGenerationBlockReason(document, shot.id);
  if (sceneBlock !== null) return { ok: false, reason: sceneBlock };
  const characters = scene.characterIds.flatMap((characterId) => {
    const character = document.characters.find((entry) => entry.id === characterId);
    return character === undefined ? [] : [`${character.name}: ${character.invariantDescription}`];
  });
  const visualStyle = productionVisualStyle(document);
  const styleReference = activeStyleReference(document);
  return {
    ok: true,
    brief: {
      target: { kind: 'storyboard', shotId: shot.id },
      targetLabel: `Storyboard for ${writerShot.label}`,
      prompt: compactParts([
        `Create a single production storyboard keyframe that can be used as the first frame for ${writerShot.label}.`,
        `Scene: ${scene.title}. Setting: ${scene.setting}. Time of day: ${scene.timeOfDay}.`,
        characters.length > 0 ? `Characters must preserve these approved identities: ${characters.join(' | ')}.` : undefined,
        styleReference === undefined ? undefined : 'Use the first attached image as the authoritative world/style reference for linework, palette, lighting, texture and environment design. Use the remaining attached images only for character identity.',
        `Framing: ${shot.framing}. Camera: ${shot.cameraMotion}. Visible action at this first frame: ${shot.action}.`,
        scene.continuityNotes.length > 0 ? `Continuity: ${scene.continuityNotes}.` : undefined,
        visualStyle.description,
        styleBiblePrompt(document),
        'Compose one finished frame only, without storyboard borders or annotations.'
      ]).join(' '),
      negativePrompt: productionNegativePrompt(document, compactParts([shot.negativePrompt])),
      aspectRatio,
      stylePreset: visualStyle.label,
      styleDescription: visualStyle.description,
      styleSource: visualStyle.source,
      referenceAssetIds: productionReferenceAssetIds(document, scene.characterIds.map((characterId) =>
        document.characters.find((character) => character.id === characterId)?.referenceAssetIds ?? []
      ))
    }
  };
}

/** Attaches an imported generated still to exactly the Character or Shot that requested it. */
export function attachGeneratedProductionImage(document: AiProjectDocument, input: {
  readonly target: ProductionImageTarget;
  readonly assetId: string;
  readonly referenceId: string;
}): ProductionMutationResult {
  const target = input.target;
  if (target.kind === 'character_reference') {
    const character = document.characters.find((entry) => entry.id === target.characterId);
    return addCharacterReference(document, {
      characterId: target.characterId,
      assetId: input.assetId,
      referenceId: input.referenceId,
      label: character === undefined ? 'Generated character reference' : `${character.name} generated reference`
    });
  }
  const writerShot = approvedWriterShots(document).find((entry) => entry.id === target.shotId);
  return assignStoryboardReference(document, {
    shotId: target.shotId,
    assetId: input.assetId,
    referenceId: input.referenceId,
    label: writerShot === undefined ? 'Generated storyboard' : `Storyboard for ${writerShot.label}`
  });
}

function stateFor(generations: readonly GenerationRecord[], approved: GenerationRecord | undefined): ProductionShotState {
  if (approved !== undefined) return 'approved';
  const viable = generations.filter((entry) => entry.review?.decision !== 'rejected');
  if (viable.some((entry) => entry.status === 'queued' || entry.status === 'running' || entry.status === 'needs_user_action')) return 'generating';
  if (viable.some((entry) => entry.status === 'completed' && entry.outputAssetIds.length === 0)) return 'needs_import';
  if (viable.some((entry) => entry.status === 'completed' && entry.outputAssetIds.length > 0)) return 'needs_review';
  if (generations.length > 0 && generations.every((entry) => entry.status === 'failed' || entry.status === 'cancelled' || entry.review?.decision === 'rejected')) return 'failed';
  return 'not_started';
}

/** A read model only: persisted Writer/generation data remains authoritative. */
export function productionShotRows(document: AiProjectDocument | null | undefined): readonly ProductionShotRow[] {
  if (document === null || document === undefined) return [];
  const writerShots = approvedWriterShots(document);
  const references = new Map(document.referenceAssets.map((entry) => [entry.id, entry]));
  return writerShots.flatMap((writerShot) => {
    const shot = document.shots.find((entry) => entry.id === writerShot.id);
    const scene = shot === undefined ? undefined : document.scenes.find((entry) => entry.id === shot.sceneId);
    if (shot === undefined || scene === undefined) return [];
    const generations = document.generations.filter((entry) => entry.shotId === shot.id);
    const approvedGeneration = generations.find((entry) => entry.review?.decision === 'approved');
    const storyboardReference = shot.referenceAssetIds
      .map((id) => references.get(id))
      .find((entry) => entry?.role === 'start_frame');
    const characterReferenceIds = scene.characterIds.flatMap((characterId) =>
      document.characters.find((entry) => entry.id === characterId)?.referenceAssetIds ?? []
    ).filter((id, index, values) => values.indexOf(id) === index);
    return [{
      shotId: shot.id,
      sceneId: scene.id,
      label: writerShot.label,
      prompt: writerShot.prompt,
      durationMs: shot.durationMs,
      sceneTitle: scene.title,
      characterIds: scene.characterIds,
      ...(storyboardReference === undefined ? {} : { storyboardReference }),
      characterReferenceIds,
      candidateCount: generations.length,
      state: stateFor(generations, approvedGeneration),
      ...(approvedGeneration === undefined ? {} : { approvedGeneration })
    }];
  });
}

export type ProductionSceneRow = {
  readonly sceneId: string;
  readonly order: number;
  readonly title: string;
  readonly objective: string;
  readonly setting: string;
  readonly timeOfDay: string;
  readonly continuityNotes: string;
  readonly durationMs: number;
  readonly shotCount: number;
  readonly approvedShotCount: number;
  readonly approved: boolean;
  readonly complete: boolean;
  readonly canApprove: boolean;
  readonly canProduce: boolean;
};

/** Ordered scenes in the active Writer plan, with approval and take progress. */
export function productionSceneRows(document: AiProjectDocument | null | undefined): readonly ProductionSceneRow[] {
  if (!document?.writerPipeline?.appliedScriptId) return [];
  const shots = productionShotRows(document);
  if (shots.length === 0) return [];
  const scenes = document.scenes
    .filter((scene) => scene.scriptVersionId === document.writerPipeline?.appliedScriptId)
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  const result: ProductionSceneRow[] = [];
  for (const scene of scenes) {
    const sceneShots = shots.filter((shot) => shot.sceneId === scene.id);
    if (sceneShots.length !== scene.shotIds.length || sceneShots.length === 0) return [];
    const approved = scene.productionApprovedAt !== undefined;
    const approvedShotCount = sceneShots.filter((shot) => shot.approvedGeneration?.status === 'completed' && (shot.approvedGeneration.outputAssetIds.length > 0)).length;
    const complete = approved && approvedShotCount === sceneShots.length;
    const previousComplete = result.every((entry) => entry.complete);
    result.push({
      sceneId: scene.id, order: scene.order, title: scene.title, objective: scene.objective,
      setting: scene.setting, timeOfDay: scene.timeOfDay, continuityNotes: scene.continuityNotes,
      durationMs: sceneShots.reduce((total, shot) => total + shot.durationMs, 0),
      shotCount: sceneShots.length, approvedShotCount, approved, complete,
      canApprove: !approved && previousComplete,
      canProduce: approved && previousComplete
    });
  }
  return result;
}

/** Checked again at submission, so a stale screen cannot spend on an unapproved scene. */
export function productionSceneGenerationBlockReason(document: AiProjectDocument, shotId: string): string | null {
  const shot = document.shots.find((entry) => entry.id === shotId);
  const scene = shot === undefined ? undefined : document.scenes.find((entry) => entry.id === shot.sceneId);
  if (scene === undefined) return 'The planned shot or scene no longer exists.';
  if (scene.scriptVersionId !== document.writerPipeline?.appliedScriptId) return null;
  const state = productionSceneRows(document).find((entry) => entry.sceneId === scene.id);
  if (!state?.approved) return `Approve ${scene.title} for production before generating its shots.`;
  return state.canProduce ? null : 'Finish and approve every take in the preceding scenes before generating this scene.';
}

/** A deliberate new take may coexist with an approved one, but not with an unresolved provider job. */
export function productionShotRegenerationBlockReason(document: AiProjectDocument, shotId: string): string | null {
  const sceneBlock = productionSceneGenerationBlockReason(document, shotId);
  if (sceneBlock !== null) return sceneBlock;
  const attempts = document.generations.filter((entry) => entry.shotId === shotId && entry.review?.decision !== 'rejected');
  if (attempts.some((entry) => ['queued', 'running', 'needs_user_action'].includes(entry.status))) {
    return 'Wait for the current shot generation to finish before starting another take.';
  }
  if (attempts.some((entry) => entry.status === 'completed' && entry.outputAssetIds.length === 0)) {
    return 'Import the completed take before starting another generation.';
  }
  return null;
}

export function approveProductionScene(document: AiProjectDocument, sceneId: string, approvedAt: string): ProductionMutationResult {
  const scene = productionSceneRows(document).find((entry) => entry.sceneId === sceneId);
  if (scene === undefined) return { ok: false, reason: 'This scene is not in the active approved Writer plan.' };
  if (scene.approved) return { ok: false, reason: 'This scene is already approved for production.' };
  if (!scene.canApprove) return { ok: false, reason: 'Approve every take in the preceding scene before starting this one.' };
  if (Number.isNaN(new Date(approvedAt).valueOf()) || new Date(approvedAt).toISOString() !== approvedAt) {
    return { ok: false, reason: 'Scene approval needs a valid timestamp.' };
  }
  return { ok: true, document: {
    ...document,
    scenes: document.scenes.map((entry) => entry.id === sceneId ? { ...entry, productionApprovedAt: approvedAt } : entry)
  } };
}

/** Targets that are actually missing; existing reviewed mappings are never overwritten by a batch. */
export function missingProductionImageTargets(
  document: AiProjectDocument,
  kind: ProductionImageTarget['kind']
): readonly ProductionImageTarget[] {
  const rows = productionShotRows(document);
  if (kind === 'storyboard') {
    const approvedScenes = new Set(productionSceneRows(document).filter((scene) => scene.canProduce).map((scene) => scene.sceneId));
    return rows.filter((row) => approvedScenes.has(row.sceneId) && row.storyboardReference === undefined)
      .slice(0, PRODUCTION_BATCH_LIMIT)
      .map((row) => ({ kind: 'storyboard' as const, shotId: row.shotId }));
  }
  const activeCharacterIds = new Set(rows.flatMap((row) => row.characterIds));
  return document.characters
    .filter((character) => activeCharacterIds.has(character.id) && character.referenceAssetIds.length === 0)
    .slice(0, PRODUCTION_BATCH_LIMIT)
    .map((character) => ({ kind: 'character_reference' as const, characterId: character.id }));
}

/** Shots safe to enqueue without duplicating an active, reviewable, or approved take. */
export function batchableProductionVideoShotIds(document: AiProjectDocument): readonly string[] {
  const approvedScenes = new Set(productionSceneRows(document).filter((scene) => scene.canProduce).map((scene) => scene.sceneId));
  return productionShotRows(document)
    .filter((row) => approvedScenes.has(row.sceneId) && (row.state === 'not_started' || row.state === 'failed'))
    .slice(0, PRODUCTION_BATCH_LIMIT)
    .map((row) => row.shotId);
}

export function assignStoryboardReference(document: AiProjectDocument, input: {
  readonly shotId: string;
  readonly assetId: string;
  readonly referenceId: string;
  readonly label: string;
}): ProductionMutationResult {
  const shot = document.shots.find((entry) => entry.id === input.shotId);
  if (shot === undefined) return { ok: false, reason: 'The Writer shot no longer exists.' };
  if (document.referenceAssets.some((entry) => entry.id === input.referenceId)) return { ok: false, reason: 'The storyboard reference id is already in use.' };
  const oldStartFrames = new Set(shot.referenceAssetIds.filter((id) => document.referenceAssets.some((entry) => entry.id === id && entry.role === 'start_frame')));
  const reference: ReferenceAsset = { id: input.referenceId, assetId: input.assetId, role: 'start_frame', label: input.label.trim() || 'Storyboard first frame' };
  return {
    ok: true,
    document: {
      ...document,
      referenceAssets: [...document.referenceAssets, reference],
      shots: document.shots.map((entry) => entry.id === shot.id ? {
        ...entry,
        referenceAssetIds: [...entry.referenceAssetIds.filter((id) => !oldStartFrames.has(id)), reference.id]
      } : entry)
    }
  };
}

export function clearStoryboardReference(document: AiProjectDocument, shotId: string): ProductionMutationResult {
  const shot = document.shots.find((entry) => entry.id === shotId);
  if (shot === undefined) return { ok: false, reason: 'The Writer shot no longer exists.' };
  const startFrames = new Set(shot.referenceAssetIds.filter((id) => document.referenceAssets.some((entry) => entry.id === id && entry.role === 'start_frame')));
  return {
    ok: true,
    document: {
      ...document,
      shots: document.shots.map((entry) => entry.id === shot.id
        ? { ...entry, referenceAssetIds: entry.referenceAssetIds.filter((id) => !startFrames.has(id)) }
        : entry)
    }
  };
}

export function addCharacterReference(document: AiProjectDocument, input: {
  readonly characterId: string;
  readonly assetId: string;
  readonly referenceId: string;
  readonly label: string;
}): ProductionMutationResult {
  const character = document.characters.find((entry) => entry.id === input.characterId);
  if (character === undefined) return { ok: false, reason: 'The Writer character no longer exists.' };
  if (character.referenceAssetIds.length >= 3) return { ok: false, reason: 'A character can have at most three active reference images.' };
  if (character.referenceAssetIds.some((id) => document.referenceAssets.find((entry) => entry.id === id)?.assetId === input.assetId)) {
    return { ok: false, reason: 'That image is already assigned to this character.' };
  }
  if (document.referenceAssets.some((entry) => entry.id === input.referenceId)) return { ok: false, reason: 'The character reference id is already in use.' };
  const reference: ReferenceAsset = { id: input.referenceId, assetId: input.assetId, role: 'character', label: input.label.trim() || character.name };
  return {
    ok: true,
    document: {
      ...document,
      referenceAssets: [...document.referenceAssets, reference],
      characters: document.characters.map((entry) => entry.id === character.id
        ? { ...entry, referenceAssetIds: [...entry.referenceAssetIds, reference.id] }
        : entry)
    }
  };
}

export function removeCharacterReference(document: AiProjectDocument, characterId: string, referenceId: string): ProductionMutationResult {
  const character = document.characters.find((entry) => entry.id === characterId);
  if (character === undefined) return { ok: false, reason: 'The Writer character no longer exists.' };
  return {
    ok: true,
    document: {
      ...document,
      characters: document.characters.map((entry) => entry.id === character.id
        ? { ...entry, referenceAssetIds: entry.referenceAssetIds.filter((id) => id !== referenceId) }
        : entry)
    }
  };
}

export function buildApprovedProductionAssemblyPlan(
  document: AiProjectDocument | null | undefined,
  assets: readonly ProductionAssetSummary[]
): ProductionAssemblyPlan {
  const rows = productionShotRows(document);
  if (rows.length === 0) return { ok: false, reason: 'Approve and save the Writer prompt stage before assembling a production cut.' };
  const scenes = productionSceneRows(document);
  if (scenes.length === 0 || scenes.some((scene) => !scene.approved)) return { ok: false, reason: 'Approve every planned scene before assembling the film.' };
  const byId = new Map(assets.map((asset) => [asset.id, asset]));
  const usedAssetIds = new Set<string>();
  const shots: ProductionAssemblyShot[] = [];
  for (const row of rows) {
    const generation = row.approvedGeneration;
    if (generation === undefined) return { ok: false, reason: `${row.label} does not have an approved candidate.` };
    if (generation.status !== 'completed') return { ok: false, reason: `${row.label} is approved but is not completed.` };
    const assetId = generation.outputAssetIds[0];
    const asset = assetId === undefined ? undefined : byId.get(assetId);
    if (asset === undefined) return { ok: false, reason: `${row.label} has no available approved output asset.` };
    if (asset.kind !== 'video') return { ok: false, reason: `${row.label} approved output is not a video.` };
    if (asset.durationMs === null || !Number.isFinite(asset.durationMs) || asset.durationMs <= 0) return { ok: false, reason: `Analyze ${row.label} video metadata before assembling the cut.` };
    if (asset.durationMs < row.durationMs) return { ok: false, reason: `${row.label} needs ${row.durationMs / 1000}s but its take is only ${asset.durationMs / 1000}s. Generate a longer take or revise the plan before assembling; dialogue timing was not changed.` };
    if (usedAssetIds.has(asset.id)) return { ok: false, reason: `${row.label} reuses an approved video from another shot. Review the candidate mapping before assembling.` };
    usedAssetIds.add(asset.id);
    shots.push({ shotId: row.shotId, assetId: asset.id, durationMs: row.durationMs, sourceDurationMs: asset.durationMs });
  }
  return { ok: true, shots, totalDurationMs: shots.reduce((total, shot) => total + shot.durationMs, 0) };
}

export function assembleApprovedProductionCut(input: {
  readonly timeline: TimelineDocument;
  readonly plan: Extract<ProductionAssemblyPlan, { readonly ok: true }>;
  readonly targetTrackId: string;
  readonly clipIdForShot: (shotId: string) => string;
}): { readonly ok: true; readonly timeline: TimelineDocument } | { readonly ok: false; readonly reason: string } {
  const track = input.timeline.tracks.find((entry) => entry.id === input.targetTrackId);
  if (track === undefined || track.kind !== 'video') return { ok: false, reason: 'Choose an existing video track for the production cut.' };
  const approvedAssets = new Set(input.plan.shots.map((entry) => entry.assetId));
  if (input.timeline.tracks.some((entry) => entry.clips.some((clip) => approvedAssets.has(clip.assetId)))) {
    return { ok: false, reason: 'At least one approved shot is already on the timeline. Remove or arrange existing production clips manually before assembling again.' };
  }
  let timeline = input.timeline;
  let cursor = trackAppendStartMs(track);
  for (const shot of input.plan.shots) {
    const next = placeClip(timeline, {
      trackId: track.id,
      clip: {
        id: input.clipIdForShot(shot.shotId),
        assetId: shot.assetId,
        timelineStartMs: cursor,
        sourceStartMs: 0,
        sourceEndMs: shot.durationMs,
        sourceDurationMs: shot.sourceDurationMs,
        effects: { ...DEFAULT_CLIP_EFFECTS },
        keyframes: []
      }
    });
    if (next === null) return { ok: false, reason: 'The production cut could not be placed without overlapping or duplicating clips.' };
    timeline = next;
    cursor += shot.durationMs;
  }
  return { ok: true, timeline };
}
