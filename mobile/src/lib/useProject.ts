import { useCallback, useSyncExternalStore } from 'react';

import { projectsEpoch, readProject, subscribeToProjects, type MobileProject } from './projectStore';

/**
 * A project, kept current while the screen is mounted.
 *
 * `readProject` at render is correct only for a component that re-renders when
 * the file changes, and the shell around the tabs does not — the writer is
 * whichever tab the user is in. `useSyncExternalStore` is the shape React gives
 * for exactly this: subscribe to the store, read the snapshot on demand.
 *
 * The snapshot has to be memoised. The store keeps no in-memory copy — the file
 * is the state — and `readProject` builds a new object every call, which React
 * compares by identity and treats as a change: returning a fresh object from
 * `getSnapshot` on every render is an infinite loop, and one that appears only
 * at runtime.
 *
 * The id is nullable because this is a hook: the shell calls it above the branch
 * that renders the project list, where there is no project to read. Calling it
 * only on the branch that has one changes the hook count between renders, which
 * crashes the app on opening a project rather than merely misbehaving.
 *
 * The cache is invalidated by the store's own epoch rather than by a listener,
 * so a write that lands while nothing is mounted still invalidates it — and it
 * does not depend on this module's listener happening to run before the ones
 * that re-render.
 */
type Entry = { readonly epoch: number; readonly project: MobileProject | null };

const cache = new Map<string, Entry>();

export function useProject(id: string | null): MobileProject | null {
  const subscribe = useCallback((onChange: () => void) => subscribeToProjects(onChange), []);
  const getSnapshot = useCallback(() => {
    if (id === null) return null;
    const cached = cache.get(id);
    if (cached !== undefined && cached.epoch === projectsEpoch()) return cached.project;
    const project = readProject(id);
    cache.set(id, { epoch: projectsEpoch(), project });
    return project;
  }, [id]);
  return useSyncExternalStore(subscribe, getSnapshot);
}
