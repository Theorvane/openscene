import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { AiProjectDocument } from '../src/shared/aiProjectDomain';
import { revisionsOf, refineShotPrompt } from '../src/shared/shotPrompt';
import { compileVideoContinuityPrompt, stripVideoContinuityLocks, videoContinuityAvailability } from '../src/shared/videoContinuity';
import {
  DEFAULT_VIDEO_CONTINUITY_CONTROLS,
  parseVideoContinuityControls,
  parseVideoContinuityPreferences,
  videoContinuityPreferencesStorageKey
} from '../src/shared/videoContinuitySettings';

const CREATED = '2026-09-09T10:00:00.000Z';

function continuityDocument(): AiProjectDocument {
  return {
    schemaVersion: 1,
    scripts: [{
      id: 'script-1', title: 'Forest story', sourceKind: 'idea', sourceText: 'A fox walks home.', screenplay: '',
      status: 'approved', createdAt: CREATED
    }],
    characters: [{
      id: 'character-fox', name: 'Red Fox', invariantDescription: 'Small red fox, white chest, green scarf.',
      referenceAssetIds: ['reference-fox']
    }],
    styleBible: {
      palette: ['forest green', 'amber'], lighting: 'Soft sunrise.', cameraGrammar: 'Low tracking shots.',
      texture: 'Natural fur and mist.', forbiddenChanges: ['Never change the green scarf.']
    },
    referenceAssets: [
      { id: 'reference-fox', assetId: 'asset-fox', role: 'character', label: 'Fox turnaround' },
      { id: 'reference-tail', assetId: 'asset-tail', role: 'start_frame', label: 'Previous tail frame' }
    ],
    scenes: [{
      id: 'scene-1', scriptVersionId: 'script-1', order: 0, title: 'Forest path', objective: 'Walk home.',
      setting: 'A mossy forest path beside a stream.', timeOfDay: 'Sunrise', characterIds: ['character-fox'],
      shotIds: ['shot-1', 'shot-2'], continuityNotes: 'The stream stays screen-left and the scarf remains dry.'
    }],
    shots: [
      {
        id: 'shot-1', sceneId: 'scene-1', order: 0, durationMs: 8_000, framing: 'Wide', cameraMotion: 'Track right',
        action: 'The fox walks right beside the stream.', dialogue: '', audioCues: [], negativePrompt: '',
        referenceAssetIds: ['reference-fox'], generationIds: []
      },
      {
        id: 'shot-2', sceneId: 'scene-1', order: 1, durationMs: 8_000, framing: 'Medium', cameraMotion: 'Continue tracking right',
        action: 'The fox steps over a fallen branch.', dialogue: '', audioCues: [], negativePrompt: '',
        referenceAssetIds: ['reference-fox', 'reference-tail'], generationIds: []
      }
    ],
    generations: [],
    provenance: []
  };
}

describe('video continuity controls', () => {
  it('exposes only locks backed by the selected Writer shot context', () => {
    const document = continuityDocument();
    expect(videoContinuityAvailability(document, 'shot-1')).toEqual({
      characterConsistency: true,
      styleConsistency: true,
      sceneConsistency: true,
      motionContinuity: false
    });
    expect(videoContinuityAvailability(document, 'shot-2')).toEqual({
      characterConsistency: true,
      styleConsistency: true,
      sceneConsistency: true,
      motionContinuity: true
    });
  });

  it('compiles enabled locks from authoritative Character, Style, Scene and Shot data', () => {
    const controls = { ...DEFAULT_VIDEO_CONTINUITY_CONTROLS, motionContinuity: true };
    const result = compileVideoContinuityPrompt('A careful cinematic shot.', continuityDocument(), 'shot-2', controls);

    expect(result.applied).toEqual(['characterConsistency', 'styleConsistency', 'sceneConsistency', 'motionContinuity']);
    expect(result.unavailable).toEqual([]);
    expect(result.prompt).toContain('[OPENSCENE_CHARACTER_LOCK]');
    expect(result.prompt).toContain('Small red fox, white chest, green scarf.');
    expect(result.prompt).toContain('[OPENSCENE_STYLE_LOCK]');
    expect(result.prompt).toContain('Palette: forest green, amber');
    expect(result.prompt).toContain('[OPENSCENE_SCENE_LOCK]');
    expect(result.prompt).toContain('A mossy forest path beside a stream.');
    expect(result.prompt).toContain('[OPENSCENE_MOTION_CONTINUITY]');
    expect(result.prompt).toContain('Previous action: The fox walks right beside the stream.');
    expect(result.prompt).toContain('Continue directly from the supplied first frame');
  });

  it('removes disabled locks on a refined take and keeps only real user revisions', () => {
    const first = compileVideoContinuityPrompt(
      'A careful cinematic shot.', continuityDocument(), 'shot-2',
      { ...DEFAULT_VIDEO_CONTINUITY_CONTROLS, motionContinuity: true }
    );
    const refined = refineShotPrompt(first.prompt, 'Make the branch movement slower.');
    if (!refined.ok) throw new Error(refined.reason);
    const second = compileVideoContinuityPrompt(refined.prompt, continuityDocument(), 'shot-2', {
      characterConsistency: false,
      styleConsistency: true,
      sceneConsistency: false,
      motionContinuity: false
    });

    expect(second.prompt).not.toContain('[OPENSCENE_CHARACTER_LOCK]');
    expect(second.prompt).not.toContain('[OPENSCENE_SCENE_LOCK]');
    expect(second.prompt).not.toContain('[OPENSCENE_MOTION_CONTINUITY]');
    expect(second.prompt).toContain('[OPENSCENE_STYLE_LOCK]');
    expect(revisionsOf(second.prompt)).toEqual(['Make the branch movement slower.']);
    expect(stripVideoContinuityLocks(first.prompt)).toBe('A careful cinematic shot.');
    expect(revisionsOf(stripVideoContinuityLocks(second.prompt))).toEqual(['Make the branch movement slower.']);
  });

  it('fails closed when stored preferences or candidate settings have the wrong shape', () => {
    expect(parseVideoContinuityPreferences(null)).toEqual(DEFAULT_VIDEO_CONTINUITY_CONTROLS);
    expect(parseVideoContinuityPreferences('{broken')).toEqual(DEFAULT_VIDEO_CONTINUITY_CONTROLS);
    expect(parseVideoContinuityControls({ ...DEFAULT_VIDEO_CONTINUITY_CONTROLS, extra: true })).toBeNull();
    expect(parseVideoContinuityControls({ ...DEFAULT_VIDEO_CONTINUITY_CONTROLS, sceneConsistency: 'yes' })).toBeNull();
    expect(videoContinuityPreferencesStorageKey('project-1')).toBe('openscene.video-continuity-controls.v1:project-1');
  });

  it('wires accessible switches, per-project preferences and candidate snapshots into desktop video generation', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/renderer/src/VideoGenerationWorkspace.tsx'), 'utf8');
    const css = readFileSync(resolve(process.cwd(), 'src/renderer/src/styles.css'), 'utf8');
    expect(source).toContain('Continuity controls');
    expect(source).toContain('role="switch"');
    expect(source).toContain('videoContinuityPreferencesStorageKey(projectId)');
    expect(source).toContain('continuityControls: effectiveContinuityControls');
    expect(source).toContain('compiledContinuity.applied.includes(key)');
    expect(source).toContain('sourceCandidate?.continuityControls ?? jobContinuityControls[job.id]');
    expect(css).toContain('.studio-toggle-list');
    expect(css).toContain('@media (max-width: 760px)');
  });

  it('queues production videos sequentially with cost confirmation and per-shot snapshots', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/renderer/src/VideoGenerationWorkspace.tsx'), 'utf8');
    expect(source).toContain('batchableProductionVideoShotIds(current)');
    expect(source).toContain('estimateVideoPlanCost(');
    expect(source).toContain('const confirmed = window.confirm(');
    expect(source).toContain('await waitForVideoTerminal(job.id)');
    expect(source).toContain('writerShotId: item.shotId');
    expect(source).toContain('referenceAssetIds: item.referenceAssetIds');
    expect(source).toContain('planProductionVideoReferences(current, row.shotId');
    expect(source).toContain('continuityControls');
  });
});
