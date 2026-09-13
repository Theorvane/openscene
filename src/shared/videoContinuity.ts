import type { AiProjectDocument, AiScene, AiShot, CharacterProfile } from './aiProjectDomain';
import { insertBeforeShotRevisions } from './shotPrompt';
import { applyWriterStyleLock, stripWriterStyleLock } from './writerPipeline';
import {
  VIDEO_CONTINUITY_CONTROL_KEYS,
  type VideoContinuityControlKey,
  type VideoContinuityControls
} from './videoContinuitySettings';

const LOCK_MARKERS: Readonly<Record<Exclude<VideoContinuityControlKey, 'styleConsistency'>, readonly [string, string]>> = {
  characterConsistency: ['[OPENSCENE_CHARACTER_LOCK]', '[/OPENSCENE_CHARACTER_LOCK]'],
  sceneConsistency: ['[OPENSCENE_SCENE_LOCK]', '[/OPENSCENE_SCENE_LOCK]'],
  motionContinuity: ['[OPENSCENE_MOTION_CONTINUITY]', '[/OPENSCENE_MOTION_CONTINUITY]']
};

export type VideoContinuityAvailability = Readonly<Record<VideoContinuityControlKey, boolean>>;

export type CompiledVideoContinuityPrompt = {
  readonly prompt: string;
  readonly applied: readonly VideoContinuityControlKey[];
  readonly unavailable: readonly VideoContinuityControlKey[];
};

function compact(value: string, max = 360): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length <= max ? normalized : `${normalized.slice(0, max - 1).trimEnd()}…`;
}

function removeMarkedBlock(prompt: string, [start, end]: readonly [string, string]): string {
  const escape = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return prompt.replace(new RegExp(`\\n?${escape(start)}[\\s\\S]*?${escape(end)}\\n?`, 'g'), '\n').trim();
}

function shotContext(document: AiProjectDocument, shotId: string): {
  readonly shot: AiShot;
  readonly scene: AiScene;
  readonly characters: readonly CharacterProfile[];
  readonly previousShot?: AiShot;
  readonly hasStartFrame: boolean;
} | null {
  const shot = document.shots.find((entry) => entry.id === shotId);
  if (shot === undefined) return null;
  const scene = document.scenes.find((entry) => entry.id === shot.sceneId);
  if (scene === undefined) return null;
  const characters = scene.characterIds.flatMap((id) => {
    const character = document.characters.find((entry) => entry.id === id);
    return character === undefined ? [] : [character];
  });
  const position = scene.shotIds.indexOf(shot.id);
  const previousShotId = position > 0 ? scene.shotIds[position - 1] : undefined;
  const previousShot = previousShotId === undefined ? undefined : document.shots.find((entry) => entry.id === previousShotId);
  const hasStartFrame = shot.referenceAssetIds.some((id) =>
    document.referenceAssets.some((reference) => reference.id === id && reference.role === 'start_frame')
  );
  return { shot, scene, characters, ...(previousShot === undefined ? {} : { previousShot }), hasStartFrame };
}

export function videoContinuityAvailability(document: AiProjectDocument | null | undefined, shotId: string): VideoContinuityAvailability {
  const context = document === null || document === undefined ? null : shotContext(document, shotId);
  return {
    characterConsistency: (context?.characters.length ?? 0) > 0,
    styleConsistency: context !== null,
    sceneConsistency: context !== null && [context.scene.setting, context.scene.timeOfDay, context.scene.continuityNotes].some((value) => value.trim().length > 0),
    motionContinuity: context?.previousShot !== undefined
  };
}

function characterLock(characters: readonly CharacterProfile[]): string {
  const lines = characters.slice(0, 8).map((character) => {
    const identity = compact(character.invariantDescription) || 'retain the approved Character Bible identity';
    const references = character.referenceAssetIds.length > 0 ? ` Match its ${character.referenceAssetIds.length} approved reference asset(s).` : '';
    return `- ${compact(character.name, 100)}: ${identity}${references}`;
  });
  const [start, end] = LOCK_MARKERS.characterConsistency;
  return [start, 'Keep these recurring characters visually identical; do not merge, replace, age or redesign them.', ...lines, end].join('\n');
}

function sceneLock(scene: AiScene): string {
  const [start, end] = LOCK_MARKERS.sceneConsistency;
  return [
    start,
    'Preserve the approved scene world unless the shot explicitly changes it.',
    `Setting: ${compact(scene.setting) || 'same approved setting'}`,
    `Time of day: ${compact(scene.timeOfDay, 120) || 'same approved time of day'}`,
    `Continuity notes: ${compact(scene.continuityNotes) || 'retain established objects, layout and palette'}`,
    end
  ].join('\n');
}

function motionLock(previousShot: AiShot, shot: AiShot, hasStartFrame: boolean): string {
  const [start, end] = LOCK_MARKERS.motionContinuity;
  return [
    start,
    hasStartFrame
      ? 'Continue directly from the supplied first frame without a pose, position or screen-direction jump.'
      : 'Continue the action and screen direction from the immediately previous Writer shot.',
    `Previous action: ${compact(previousShot.action) || 'continue the established action'}`,
    `Previous camera movement: ${compact(previousShot.cameraMotion, 180) || 'retain the established camera axis'}`,
    `Current action: ${compact(shot.action) || 'follow the approved current shot action'}`,
    `Current camera movement: ${compact(shot.cameraMotion, 180) || 'use the approved current camera movement'}`,
    end
  ].join('\n');
}

export function compileVideoContinuityPrompt(
  prompt: string,
  document: AiProjectDocument,
  shotId: string,
  controls: VideoContinuityControls
): CompiledVideoContinuityPrompt {
  const context = shotContext(document, shotId);
  let compiled = stripVideoContinuityLocks(prompt);
  if (context === null) return { prompt: compiled, applied: [], unavailable: VIDEO_CONTINUITY_CONTROL_KEYS.filter((key) => controls[key]) };

  const availability = videoContinuityAvailability(document, shotId);
  const applied = VIDEO_CONTINUITY_CONTROL_KEYS.filter((key) => controls[key] && availability[key]);
  const unavailable = VIDEO_CONTINUITY_CONTROL_KEYS.filter((key) => controls[key] && !availability[key]);

  if (applied.includes('styleConsistency')) compiled = applyWriterStyleLock(compiled, document.styleBible);
  if (applied.includes('characterConsistency')) compiled = insertBeforeShotRevisions(compiled, characterLock(context.characters));
  if (applied.includes('sceneConsistency')) compiled = insertBeforeShotRevisions(compiled, sceneLock(context.scene));
  if (applied.includes('motionContinuity') && context.previousShot !== undefined) {
    compiled = insertBeforeShotRevisions(compiled, motionLock(context.previousShot, context.shot, context.hasStartFrame));
  }
  return { prompt: compiled, applied, unavailable };
}

/** Keeps the provider lock blocks auditable in the saved request but hidden
 * from the editable composer and candidate summary. */
export function stripVideoContinuityLocks(prompt: string): string {
  let editable = stripWriterStyleLock(prompt);
  for (const marker of Object.values(LOCK_MARKERS)) editable = removeMarkedBlock(editable, marker);
  return editable;
}
