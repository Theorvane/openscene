import { describe, expect, it } from 'vitest';

import { APP_NAVIGATION_HISTORY_LIMIT, popPageHistory, pushPageHistory } from '../src/renderer/src/appNavigationHistory';
import type { AppPageId } from '../src/renderer/src/appPages';

describe('app navigation history', () => {
  it('pushes the page being left and pops it back in order', () => {
    let history = pushPageHistory([], 'projects');
    history = pushPageHistory(history, 'edit');
    history = pushPageHistory(history, 'edit');

    const first = popPageHistory(history);
    expect(first.target).toBe('edit');
    const second = popPageHistory(first.rest);
    expect(second.target).toBe('edit');
    const third = popPageHistory(second.rest);
    expect(third.target).toBe('projects');
    expect(popPageHistory(third.rest)).toEqual({ target: null, rest: [] });
  });

  it('caps the stack at the history limit by dropping the oldest entries', () => {
    let history: readonly AppPageId[] = [];
    for (let index = 0; index < APP_NAVIGATION_HISTORY_LIMIT + 5; index += 1) {
      history = pushPageHistory(history, index % 2 === 0 ? 'edit' : 'settings');
    }

    expect(history.length).toBe(APP_NAVIGATION_HISTORY_LIMIT);
    // The most recent push (index 24, even) must survive the cap.
    expect(popPageHistory(history).target).toBe('edit');
  });
});
