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
    expect(desktop).toContain('Optional · create storyboard frames');
    expect(desktop).toContain('approveProductionScene');
    expect(desktop).toContain('productionSceneRows(document)');
    expect(desktop).toContain('StoryboardSlate projectId={projectId}');
    expect(desktop).toContain('productionShotVisual(row)');
    expect(desktop).toContain('onGenerateVideoScene(selectedScene!.sceneId)');
    expect(desktop).toContain('Planned video prompt');
    expect(desktop).toContain('Regenerate this shot');
    expect(desktop).toContain('onGenerateVideoShot(shotId)');
    expect(desktopEditor).toContain('buildApprovedProductionAssemblyPlan(project.ai');
    expect(desktopEditor).toContain('assembleApprovedProductionCut({');
    expect(mobile).toContain('productionShotRows(activeProject?.ai)');
    const mobileSubmission = mobile.slice(mobile.indexOf('const runGeneration ='), mobile.indexOf('const approveTake ='));
    expect(mobileSubmission.indexOf('standaloneGenerationBlockReason(current.ai)')).toBeLessThan(mobileSubmission.indexOf('generateShot({'));
    expect(mobileSubmission).toContain('standaloneGenerationBlockReason(latest.ai)');
    const mobileRedo = mobile.slice(mobile.indexOf('const redoShot ='), mobile.indexOf('const reviewTake ='));
    expect(mobileRedo.indexOf('standaloneGenerationBlockReason(current.ai)')).toBeLessThan(mobileRedo.indexOf('generateShot({'));
    const mobileAgent = await source('mobile/src/lib/agentTools.ts');
    const agentSubmission = mobileAgent.slice(mobileAgent.indexOf('export const GENERATE_VIDEO_TOOL'), mobileAgent.indexOf('export const AGENT_TOOLS'));
    expect(agentSubmission.indexOf('standaloneGenerationBlockReason(current.ai)')).toBeLessThan(agentSubmission.indexOf('generateShot({'));
    expect(mobile).toContain('standaloneBlock === null');
    expect(mobile).not.toContain('setPrompt(shot.prompt)');
    const desktopWorkspace = await source('src/renderer/src/VideoGenerationWorkspace.tsx');
    const desktopSubmission = desktopWorkspace.slice(desktopWorkspace.indexOf('const handleGenerate ='), desktopWorkspace.indexOf('const openProductionShot ='));
    expect(desktopSubmission.indexOf('standaloneGenerationBlockReason(documentRef.current, targetWriterShotId)')).toBeLessThan(desktopSubmission.indexOf('setIsGenerating(true)'));
    const mobileRunBoard = await source('mobile/src/components/ProductionRunBoard.tsx');
    expect(mobileRunBoard).toContain('approveProductionScene');
    expect(mobileRunBoard).toContain('productionSceneRows(project?.ai)');
    expect(mobileRunBoard).toContain('productionShotRows(project?.ai)');
    expect(mobileRunBoard).toContain('if (shots.length === 0) return null');
    expect(mobileRunBoard).toContain('StoryboardSlate projectId={projectId}');
    expect(mobileRunBoard).toContain('productionShotVisual(row)');
    expect(mobileRunBoard).toContain('visual.takeAssetId ?? visual.storyboardAssetId');
    expect(mobileRunBoard).toContain('showVideoPreview={active && storyboardPreviewId === row.shotId}');
    expect(mobileRunBoard).toContain('Preview approved take');
    expect(mobileRunBoard).toContain('Planned video prompt');
    expect(mobileRunBoard).toContain('Regenerate this shot');
    expect(mobileRunBoard).toContain('productionTextShot');
    expect(mobileRunBoard).toContain('productionTextBatch(current.ai, model.id, selection.sceneId)');
    expect(mobileRunBoard).toContain('assembleApprovedWriterShots(latest)');
    expect(mobile).toContain('productionRows.length === 0 && showQuickClip');
    expect(mobile).not.toContain('Storyboard production board');
    expect(mobileStore).toContain('buildApprovedProductionAssemblyPlan(project.ai');
    expect(mobileStore).toContain('assembleApprovedProductionCut({');
    expect(desktop).not.toContain('aiGenerateVideo');
  });

  it('uses one planning entry and keeps film progress behind a disclosure on both surfaces', async () => {
    const [desktop, board, mobile, mobileBoard] = await Promise.all([
      source('src/renderer/src/VideoGenerationWorkspace.tsx'),
      source('src/renderer/src/ProductionBoard.tsx'),
      source('mobile/src/screens/PlanScreen.tsx'),
      source('mobile/src/components/ProductionRunBoard.tsx')
    ]);
    expect(desktop).toContain('productionShotRows(writerDocument).length > 0 &&');
    expect(board).toContain('<details className="production-board__production-notes">');
    expect(board).toContain("summary.stage === 'review'");
    expect(mobile).toContain('productionRows.length === 0 && <ProductionPlanComposer');
    expect(mobileBoard).toContain('if (shots.length === 0) return null');
    expect(mobileBoard).toContain('{showProductionNotes && <>');
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
