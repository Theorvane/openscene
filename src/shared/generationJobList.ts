/** Keep one visible row per job when a recovery poll races a new submission. */
export function upsertGenerationJob<T extends { readonly id: string }>(jobs: readonly T[], job: T): readonly T[] {
  const seen = new Set<string>();
  const hasJob = jobs.some((candidate) => candidate.id === job.id);
  const next = (hasJob ? jobs : [job, ...jobs]).filter((candidate) => {
    if (seen.has(candidate.id)) return false;
    seen.add(candidate.id);
    return true;
  }).map((candidate) => candidate.id === job.id ? job : candidate);
  return next;
}
