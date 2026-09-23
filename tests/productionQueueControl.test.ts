import { describe, expect, it } from 'vitest';
import { createProductionQueueControl } from '../src/shared/productionQueueControl';

describe('production queue control', () => {
  it('locks concurrent runs and does not clear a stop on duplicate start', () => {
    const queue = createProductionQueueControl();
    expect(queue.canSubmit()).toBe(false);
    expect(queue.begin()).toBe(true);
    expect(queue.canSubmit()).toBe(true);
    queue.requestStop();
    expect(queue.begin()).toBe(false);
    expect(queue.canSubmit()).toBe(false);
    expect(queue.wasStopped()).toBe(true);
    queue.finish();
    expect(queue.canSubmit()).toBe(false);
    expect(queue.begin()).toBe(true);
    expect(queue.wasStopped()).toBe(false);
    expect(queue.canSubmit()).toBe(true);
  });
  it('saves an in-flight result but never submits the next shot after stop', async () => {
    const queue = createProductionQueueControl();
    const submitted: number[] = [], saved: number[] = [];
    queue.begin();
    for (const shot of [1, 2, 3]) {
      if (!queue.canSubmit()) break;
      submitted.push(shot);
      await Promise.resolve().then(() => queue.requestStop());
      saved.push(shot);
    }
    queue.finish();
    expect(submitted).toEqual([1]);
    expect(saved).toEqual([1]);
  });
});
