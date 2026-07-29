import { describe, expect, it } from 'vitest';

import { closeProjectTab, openProjectTab, pruneProjectTabs } from '../src/renderer/src/projectTabs';

const tab = (id: string, name = id) => ({ id, name });

describe('project tabs', () => {
  it('opens a project once and keeps its position when reopened', () => {
    const opened = openProjectTab([tab('a'), tab('b')], tab('c'));
    expect(opened.map((item) => item.id)).toEqual(['a', 'b', 'c']);

    // Reopening an already-open project must not duplicate or reorder it.
    const again = openProjectTab(opened, tab('a', 'Renamed'));
    expect(again.map((item) => item.id)).toEqual(['a', 'b', 'c']);
    expect(again[0]?.name).toBe('Renamed');
  });

  it('moves to the neighbour when the active tab closes', () => {
    const tabs = [tab('a'), tab('b'), tab('c')];

    expect(closeProjectTab(tabs, 'b', 'b').activeId).toBe('c');
    // No tab to the right, so the one to the left takes over.
    expect(closeProjectTab(tabs, 'c', 'c').activeId).toBe('b');
    expect(closeProjectTab([tab('a')], 'a', 'a')).toEqual({ tabs: [], activeId: null });
  });

  it('leaves the active project alone when a background tab closes', () => {
    const result = closeProjectTab([tab('a'), tab('b')], 'a', 'b');

    expect(result.activeId).toBe('b');
    expect(result.tabs.map((item) => item.id)).toEqual(['b']);
  });

  it('drops tabs for projects that no longer exist', () => {
    // A project removed from the list must not linger as an unopenable tab.
    expect(pruneProjectTabs([tab('a'), tab('b')], ['b']).map((item) => item.id)).toEqual(['b']);
  });
});
