import { describe, expect, it, vi } from 'vitest';

import { TimelineIpcService } from '../src/main/timelineIpcService';
import { createEmptyAiProjectDocument } from '../src/shared/aiProjectDomain';

describe('AI project IPC service', () => {
  it('validates the shared payload before saving through ProjectStore', async () => {
    const saved = { id: 'project-1' };
    const saveAiProjectDocument = vi.fn(async () => saved);
    const service = new TimelineIpcService({
      projects: { saveAiProjectDocument } as never,
      assets: {} as never
    });
    const ai = createEmptyAiProjectDocument();

    await expect(service.saveAiProjectDocument({ projectId: 'project-1', ai })).resolves.toEqual({ ok: true, value: saved });
    await expect(service.saveAiProjectDocument({ projectId: '../project', ai })).resolves.toMatchObject({
      ok: false,
      error: { code: 'INVALID_INPUT' }
    });
    expect(saveAiProjectDocument).toHaveBeenCalledTimes(1);
    expect(saveAiProjectDocument).toHaveBeenCalledWith('project-1', ai);
  });
});
