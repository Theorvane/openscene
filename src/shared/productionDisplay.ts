/** Display time, not frame timecode: generation plans are millisecond-based. */
export function productionTimeLabel(ms: number): string {
  const value = Math.max(0, Math.floor(Number.isFinite(ms) ? ms : 0));
  const seconds = Math.floor(value / 1000);
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}.${String(value % 1000).padStart(3, '0')}`;
}
export function productionRuler(durationMs: number) {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return [];
  return Array.from({ length: 5 }, (_, index) => ({ position: index * 25, label: productionTimeLabel(durationMs * index / 4) }));
}
