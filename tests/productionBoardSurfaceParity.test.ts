import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

async function source(path: string): Promise<string> {
  return readFile(new URL(`../${path}`, import.meta.url), 'utf8');
}

describe('production board surface parity', () => {
  it('uses shared production rules and keeps review/attachment explicit on desktop and mobile', async () => {
    const [desktop, desktopEditor, mobile, mobileStore] = await Promise.all([
      source('src/renderer/src/ProductionBoard.tsx'),
      source('src/renderer/src/editor/useTimelineEditor.ts'),
      source('mobile/src/screens/PlanScreen.tsx'),
      source('mobile/src/lib/projectStore.ts')
    ]);
    expect(desktop).toContain('productionShotRows(document)');
    expect(desktop).toContain('activeCharacterIds.has(character.id)');
    expect(desktop).toContain('assignStoryboardReference(document');
    expect(desktop).toContain('addCharacterReference(document');
    expect(desktop).toContain("missingProductionImageTargets(document, 'character_reference')");
    expect(desktop).toContain('onGenerateImages(targets)');
    expect(desktop).toContain('Generate now');
    expect(desktop).toContain('World/style reference');
    expect(desktop).toContain('assignStyleReference');
    expect(desktop).toContain('Generate image now');
    expect(desktop).toContain('Generate storyboards for approved scene');
    expect(desktop).toContain('approveProductionScene');
    expect(desktop).toContain('productionSceneRows(document)');
    expect(desktop).toContain('StoryboardSlate projectId={projectId}');
    expect(desktop).toContain('productionShotVisual(row)');
    expect(desktop).toContain('pending shot(s) in this scene');
    expect(desktop).toContain('onGenerateVideoScene(selectedScene!.sceneId)');
    expect(desktop).toContain('Planned video prompt');
    expect(desktop).toContain('Regenerate this shot');
    expect(desktop).toContain('onGenerateVideoShot(shotId)');
    expect(desktopEditor).toContain('buildApprovedProductionAssemblyPlan(project.ai');
    expect(desktopEditor).toContain('assembleApprovedProductionCut({');
    expect(mobile).toContain('productionShotRows(activeProject?.ai)');
    const mobileRunBoard = await source('mobile/src/components/ProductionRunBoard.tsx');
    expect(mobileRunBoard).toContain('approveProductionScene');
    expect(mobileRunBoard).toContain('productionSceneRows(project?.ai)');
    expect(mobileRunBoard).toContain('productionShotRows(project?.ai)');
    expect(mobileRunBoard).toContain('StoryboardSlate projectId={projectId}');
    expect(mobileRunBoard).toContain('productionShotVisual(row)');
    expect(mobileRunBoard).toContain('Planned video prompt');
    expect(mobileRunBoard).toContain('Regenerate this shot');
    expect(mobileRunBoard).toContain('productionTextShot');
    expect(mobileRunBoard).toContain('productionTextBatch(current.ai, model.id, selection.sceneId)');
    expect(mobile).toContain('activeStyleReference(activeProject.ai)');
    expect(mobile).toContain('World/style reference:');
    expect(mobile).toContain('assembleApprovedWriterShots(activeProject)');
    expect(mobile).toContain('Mobile can generate an approved scene with a compatible text-to-video model');
    expect(mobileStore).toContain('buildApprovedProductionAssemblyPlan(project.ai');
    expect(mobileStore).toContain('assembleApprovedProductionCut({');
    expect(desktop).not.toContain('aiGenerateVideo');
  });

  it('exposes image import in Editing for the production board reference library', async () => {
    const [assetBin, main] = await Promise.all([
      source('src/renderer/src/editor/AssetBin.tsx'),
      source('src/main/index.ts')
    ]);
    expect(assetBin).toContain("editor.importAssets(['image'])");
    expect(assetBin).toContain('+ Image');
    expect(assetBin).toContain('Local video, audio and images stay on this machine.');
    expect(main).toContain("acceptedKinds[0] === 'image'");
    expect(main).toContain("extensions: ['jpeg', 'jpg', 'png', 'webp']");
  });
});
