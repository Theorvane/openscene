import { expect, it } from 'vitest';
import { productionTimeLabel, productionRuler } from '../src/shared/productionDisplay';
it('formats plan milliseconds without implying a video frame rate', () => {
  expect(productionTimeLabel(61023)).toBe('01:01.023');
  expect(productionTimeLabel(-100)).toBe('00:00.000');
  expect(productionTimeLabel(NaN)).toBe('00:00.000');
  expect(productionTimeLabel(7200000)).toBe('120:00.000');
});
it('keeps ruler endpoints aligned with the plan', () => {
  expect(productionRuler(0)).toEqual([]);
  expect(productionRuler(Infinity)).toEqual([]);
  expect(productionRuler(8000).map(tick => tick.label)).toEqual(['00:00.000', '00:02.000', '00:04.000', '00:06.000', '00:08.000']);
});
