/** Cooperative stop: finish saving the submitted job, never submit another one.
 * This does not cancel provider jobs or reverse charges. A new run needs consent.
 */
export function createProductionQueueControl() {
  let active = false;
  let stopped = false;
  return {
    begin() {
      if (active) return false;
      active = true; stopped = false;
      return true;
    },
    requestStop() { if (active) stopped = true; },
    canSubmit() { return active && !stopped; },
    wasStopped() { return stopped; },
    finish() { active = false; }
  };
}
