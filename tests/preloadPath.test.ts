import { describe, expect, it } from 'vitest';

import { resolvePreloadScriptPath } from '../src/main/preloadPath';

describe('preload path resolution', () => {
  it('resolves the emitted preload bundle path from the main output directory', () => {
    expect(resolvePreloadScriptPath('/Users/jungwon/Dev/video/out/main')).toBe(
      '/Users/jungwon/Dev/video/out/preload/index.cjs'
    );
    expect(resolvePreloadScriptPath('C:\\OpenScene\\out\\main')).toBe('C:\\OpenScene\\out\\preload\\index.cjs');
  });
});
