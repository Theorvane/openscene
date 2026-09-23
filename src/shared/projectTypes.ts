import type { WorkspaceMode } from './workspaceModes';

export type ProjectType = 'editing' | 'generation';
/** Absence is the legacy mixed project, never inferred from its assets. */
export function parseProjectType(value: unknown): ProjectType | undefined | null {
  return value === undefined ? undefined : value === 'editing' || value === 'generation' ? value : null;
}
export function projectTypeForMode(mode: WorkspaceMode): ProjectType {
  return mode === 'edit' ? 'editing' : 'generation';
}
export function modeForProjectType(type: ProjectType | undefined, fallback: WorkspaceMode = 'edit'): WorkspaceMode {
  return type === undefined ? fallback : type === 'editing' ? 'edit' : 'create';
}
