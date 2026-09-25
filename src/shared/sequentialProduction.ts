import type { AiProjectDocument, PendingSequentialScene } from './aiProjectDomain';
import { createEmptyAiProjectDocument, parseAiProjectDocument } from './aiProjectDomain';
import { productionSceneRows } from './productionWorkflow';
import { pipelineBaseRequest, parseWriterPromptText } from './writerPipeline';
import { applyWriterDraft, parseWriterRequest, validateWriterResponse, writerDraftDurationSeconds, type WriterDraft, type WriterRequest } from './writerWorkflow';

const MAX_FILM_SECONDS = 900;
const MAX_SCENE_SECONDS = 180;

function activeSequentialRequest(document: AiProjectDocument): WriterRequest {
  const request = pipelineBaseRequest(document.writerPipeline);
  if (request?.productionScope === undefined || !document.writerPipeline?.appliedScriptId) {
    throw new Error('Start a scene-by-scene film before adding another scene.');
  }
  return request;
}

export function canPlanNextSequentialScene(document: AiProjectDocument): boolean {
  if (pipelineBaseRequest(document.writerPipeline)?.productionScope === undefined) return false;
  const scenes = productionSceneRows(document);
  return scenes.length > 0 && scenes.every(scene => scene.complete);
}

export function buildNextSequentialSceneRequest(document: AiProjectDocument, brief: string, seconds: number): WriterRequest {
  const base = activeSequentialRequest(document);
  if (!canPlanNextSequentialScene(document)) throw new Error('Approve every take in the current scene first.');
  if (!brief.trim()) throw new Error('Describe what happens in the next scene.');
  if (!Number.isSafeInteger(seconds) || seconds < 5 || seconds > MAX_SCENE_SECONDS || seconds % 5 !== 0) {
    throw new Error('A scene must be 5–180 seconds in five-second shots.');
  }
  if (base.targetDurationSeconds + seconds > MAX_FILM_SECONDS) throw new Error('This film has reached the 15-minute planning limit.');
  const previous = document.writerPipeline?.artifacts.find(item => item.stage === 'prompts');
  const draft = previous ? parseWriterPromptText(previous.content) : null;
  if (!draft) throw new Error('The approved film plan is unavailable.');
  const last = draft.scenes[draft.scenes.length - 1];
  const context = [
    'FILM PREMISE: ' + base.sourceText,
    'PREVIOUS SCENE: ' + (last?.title ?? ''),
    'LAST CONTINUITY STATE: ' + (last?.continuityNotes ?? ''),
    'ESTABLISHED CHARACTERS: ' + draft.characters.map(item => item.name + ': ' + item.invariantDescription).join('; '),
    'VISUAL STYLE: ' + JSON.stringify(draft.styleBible),
    'NEXT SCENE BRIEF: ' + brief.trim()
  ].join('\n');
  return { ...base, productionScope: 'scene', sourceText: context, targetDurationSeconds: seconds };
}

function checkedDraft(request: WriterRequest, value: unknown): WriterDraft {
  const parsed = parseWriterRequest(request);
  if (parsed?.productionScope !== 'scene' || parsed.stage !== undefined || parsed.targetDurationSeconds > MAX_SCENE_SECONDS) {
    throw new Error('The next-scene request is invalid.');
  }
  const result = validateWriterResponse(value, parsed);
  if (!result.ok) throw new Error(result.issue.path + ': ' + result.issue.message);
  if (writerDraftDurationSeconds(result.value) !== parsed.targetDurationSeconds) throw new Error('The shot lengths must total the requested scene length.');
  return result.value;
}

export function proposeNextSequentialScene(document: AiProjectDocument, request: WriterRequest, draft: WriterDraft, modelId: string): AiProjectDocument {
  if (!canPlanNextSequentialScene(document)) throw new Error('Finish and approve the current scene before planning the next one.');
  const checked = checkedDraft(request, draft);
  const previousArtifact = document.writerPipeline?.artifacts.find(item => item.stage === 'prompts');
  const previous = previousArtifact ? parseWriterPromptText(previousArtifact.content) : null;
  if (!previous) throw new Error('The approved film plan is unavailable.');
  const established = new Map(previous.characters.map(item => [item.name.toLocaleLowerCase(), item]));
  const normalizedCharacters = checked.characters.map(item => established.get(item.name.toLocaleLowerCase()) ?? item);
  const canonicalNames = new Map(normalizedCharacters.map(item => [item.name.toLocaleLowerCase(), item.name]));
  const normalized: WriterDraft = {
    ...checked,
    characters: normalizedCharacters,
    styleBible: previous.styleBible,
    scenes: checked.scenes.map(scene => ({
      ...scene,
      characterNames: scene.characterNames.map(name => canonicalNames.get(name.toLocaleLowerCase()) ?? name)
    }))
  };
  const pending: PendingSequentialScene = {
    baseScriptId: document.writerPipeline!.appliedScriptId!,
    baseShotCount: document.shots.filter(item => document.scenes.some(scene => scene.scriptVersionId === document.writerPipeline!.appliedScriptId && scene.id === item.sceneId)).length,
    requestJson: JSON.stringify(request),
    draftJson: JSON.stringify(normalized),
    modelId
  };
  const parsed = parseAiProjectDocument({ ...document, pendingSequentialScene: pending });
  if (!parsed) throw new Error('The proposed scene exceeds project storage limits.');
  return parsed;
}

export function approveNextSequentialScene(document: AiProjectDocument, createdAt: string, idPrefix: string): AiProjectDocument {
  const base = activeSequentialRequest(document);
  if (!canPlanNextSequentialScene(document)) throw new Error('Finish the current scene before adding another one.');
  const pending = document.pendingSequentialScene;
  if (!pending) throw new Error('Generate and review the next scene first.');
  if (pending.baseScriptId !== document.writerPipeline!.appliedScriptId || pending.baseShotCount !== document.shots.filter(item => document.scenes.some(scene => scene.scriptVersionId === pending.baseScriptId && scene.id === item.sceneId)).length) {
    throw new Error('The film plan changed after this proposal. Discard it and plan the next scene again.');
  }
  let request: WriterRequest | null;
  let value: unknown;
  try {
    request = parseWriterRequest(JSON.parse(pending.requestJson));
    value = JSON.parse(pending.draftJson);
  } catch { throw new Error('The saved next-scene proposal is invalid.'); }
  if (!request) throw new Error('The saved next-scene request is invalid.');
  const draft = checkedDraft(request, value);
  if (base.targetDurationSeconds + request.targetDurationSeconds > MAX_FILM_SECONDS) throw new Error('This film would exceed 15 minutes.');
  const pipeline = document.writerPipeline!;
  const previousArtifact = pipeline.artifacts.find(item => item.stage === 'prompts');
  const previous = previousArtifact ? parseWriterPromptText(previousArtifact.content) : null;
  if (!previous) throw new Error('The existing approved shot plan is unavailable.');
  const scriptId = pipeline.appliedScriptId!;
  const script = document.scripts.find(item => item.id === scriptId);
  if (!script) throw new Error('The active film script is missing.');

  const known = new Map(previous.characters.map(item => [item.name.toLocaleLowerCase(), item]));
  const normalizedCharacters = draft.characters.map(item => known.get(item.name.toLocaleLowerCase()) ?? item);
  const mergedCharacters = [...previous.characters];
  for (const item of normalizedCharacters) if (!known.has(item.name.toLocaleLowerCase())) mergedCharacters.push(item);
  const nextScene = draft.scenes[0]!;
  const merged: WriterDraft = {
    ...previous,
    screenplay: previous.screenplay + '\n\n' + draft.screenplay,
    characters: mergedCharacters,
    scenes: [...previous.scenes, nextScene]
  };
  const totalSeconds = writerDraftDurationSeconds(merged);
  const aggregateRequest = parseWriterRequest({ ...base, productionScope: 'sequence', targetDurationSeconds: totalSeconds });
  if (!aggregateRequest) throw new Error('The combined film plan is invalid.');
  const { productionScope: _scope, ...filmRequest } = aggregateRequest;
  const result = validateWriterResponse(merged, filmRequest);
  if (!result.ok) throw new Error(result.issue.path + ': ' + result.issue.message);

  const temp = applyWriterDraft({ document: createEmptyAiProjectDocument(), request, draft, createdAt, idPrefix });
  if (!temp.ok) throw new Error(temp.message);
  const newScene = temp.document.scenes[0]!;
  const currentCharacterIds = new Map(document.characters.map(item => [item.name.toLocaleLowerCase(), item.id]));
  const addedCharacters = temp.document.characters.filter(item => !currentCharacterIds.has(item.name.toLocaleLowerCase()));
  for (const item of addedCharacters) currentCharacterIds.set(item.name.toLocaleLowerCase(), item.id);
  const scene = {
    ...newScene,
    scriptVersionId: scriptId,
    order: previous.scenes.length,
    characterIds: nextScene.characterNames.map(name => currentCharacterIds.get(name.toLocaleLowerCase())!)
  };
  const { pendingSequentialScene: _discard, ...rest } = document;
  const candidate: AiProjectDocument = {
    ...rest,
    scripts: document.scripts.map(item => item.id === scriptId ? { ...item, screenplay: merged.screenplay } : item),
    scenes: [...document.scenes, scene],
    shots: [...document.shots, ...temp.document.shots],
    characters: [...document.characters, ...addedCharacters],
    writerPipeline: {
      ...pipeline,
      requestJson: JSON.stringify(aggregateRequest),
      artifacts: pipeline.artifacts.map(item => item.stage === 'prompts'
        ? { ...item, content: JSON.stringify(merged, null, 2) }
        : item.stage === 'screenplay' ? { ...item, content: merged.screenplay } : item)
    }
  };
  const parsed = parseAiProjectDocument(candidate);
  if (!parsed) throw new Error('The next scene could not be added without changing the existing film.');
  return parsed;
}

export function discardNextSequentialScene(document: AiProjectDocument): AiProjectDocument {
  const { pendingSequentialScene: _discard, ...rest } = document;
  return rest;
}
