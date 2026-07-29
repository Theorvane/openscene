/**
 * Open-project tabs for the top bar.
 *
 * A tab remembers which project is open, not a separate editor session: the
 * editor keeps one in-memory timeline, so switching loads the next project from
 * disk. Callers persist unsaved work first — see `AppShell`'s switch handler.
 */
export type ProjectTab = {
  readonly id: string;
  readonly name: string;
};

/** Adds a project, or moves the existing tab's label into sync, keeping order. */
export function openProjectTab(tabs: readonly ProjectTab[], tab: ProjectTab): readonly ProjectTab[] {
  const existing = tabs.findIndex((candidate) => candidate.id === tab.id);
  if (existing === -1) return [...tabs, tab];
  return tabs.map((candidate) => (candidate.id === tab.id ? tab : candidate));
}

/**
 * Closes a tab and reports which project should be shown next: the neighbour to
 * the right, else the left, else none. Closing a background tab leaves the
 * active one alone.
 */
export function closeProjectTab(
  tabs: readonly ProjectTab[],
  closingId: string,
  activeId: string | null
): { readonly tabs: readonly ProjectTab[]; readonly activeId: string | null } {
  const index = tabs.findIndex((tab) => tab.id === closingId);
  if (index === -1) return { tabs, activeId };

  const remaining = tabs.filter((tab) => tab.id !== closingId);
  if (activeId !== closingId) return { tabs: remaining, activeId };
  const next = remaining[index] ?? remaining[index - 1] ?? null;
  return { tabs: remaining, activeId: next?.id ?? null };
}

/** Drops tabs whose project no longer exists, so a deleted project cannot linger. */
export function pruneProjectTabs(
  tabs: readonly ProjectTab[],
  knownProjectIds: readonly string[]
): readonly ProjectTab[] {
  const known = new Set(knownProjectIds);
  return tabs.filter((tab) => known.has(tab.id));
}
