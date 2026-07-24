import { createContext, useContext, type ReactElement, type ReactNode } from 'react';

import type { StatusMessage } from './appTypes';
import type { TimelineEditorController } from './editor/useTimelineEditor';

type ActiveProjectSummary = {
  readonly id: string;
  readonly name: string;
};

type ProjectResultImportContextValue = {
  readonly activeProject: ActiveProjectSummary | null;
  readonly isImporting: boolean;
  readonly importRecordingResult: (sessionId: string) => Promise<StatusMessage>;
  readonly importTtsResult: (jobId: string) => Promise<StatusMessage>;
};

type ProjectResultImportProviderProps = {
  readonly children: ReactNode;
  readonly editor: TimelineEditorController;
};

const ProjectResultImportContext = createContext<ProjectResultImportContextValue | null>(null);

export function ProjectResultImportProvider({ children, editor }: ProjectResultImportProviderProps): ReactElement {
  const value: ProjectResultImportContextValue = {
    activeProject: editor.project === null ? null : { id: editor.project.id, name: editor.project.name },
    importRecordingResult: editor.importRecordingResult,
    importTtsResult: editor.importTtsResult,
    isImporting: editor.isBusy
  };

  return <ProjectResultImportContext.Provider value={value}>{children}</ProjectResultImportContext.Provider>;
}

export function useProjectResultImport(): ProjectResultImportContextValue {
  const value = useContext(ProjectResultImportContext);
  if (value !== null) return value;
  throw new Error('Project result import context is unavailable.');
}
