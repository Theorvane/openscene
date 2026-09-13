import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const readRepo = (path: string): Promise<string> => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

describe('media capability surface parity', () => {
  it('uses the shared registry in desktop, mobile, planning and execution', async () => {
    const [desktop, mobileScreen, mobileExecution, planner, jobs] = await Promise.all([
      readRepo('src/renderer/src/VideoGenerationWorkspace.tsx'),
      readRepo('mobile/src/screens/PlanScreen.tsx'),
      readRepo('mobile/src/lib/videoGeneration.ts'),
      readRepo('src/shared/videoStoryboardPlan.ts'),
      readRepo('src/main/aiJobManager.ts')
    ]);

    expect(desktop).toContain("from '../../shared/mediaCapabilityRegistry'");
    expect(desktop).toContain('aspectRatioOptions.map');
    expect(mobileScreen).toContain('modelId: model.id');
    expect(mobileScreen).toContain('supportsReferenceImage(model?.id');
    expect(mobileScreen).toContain('getVideoOperationConstraints(model.id, operation)');
    expect(mobileScreen).toContain('aspectRatioOptions.map');
    expect(desktop).toContain("{ id: 'start_end', label: 'Start-End' }");
    expect(desktop).toContain("{ id: 'reference_to_video', label: 'References' }");
    expect(mobileScreen).toContain("{ id: 'start_end', label: 'Start-End' }");
    expect(mobileScreen).toContain("base64: true");
    expect(mobileScreen).toContain('accessibilityLabel={`Reference image ${value.displayName}`}');
    expect(mobileExecution).toContain('validateVideoRequest({');
    expect(planner).toContain("from './mediaCapabilityRegistry'");
    expect(jobs.indexOf('validateVideoRequest({')).toBeLessThan(jobs.indexOf('await reserveSpend('));
  });

  it('does not keep the removed provider-level duration and reference tables', async () => {
    const [planner, generation] = await Promise.all([
      readRepo('src/shared/videoStoryboardPlan.ts'),
      readRepo('src/shared/videoGeneration.ts')
    ]);
    expect(planner).not.toContain('const SUPPORTED_SHOT_SECONDS');
    expect(generation).not.toContain("return providerId === 'google_gemini'");
  });
});
