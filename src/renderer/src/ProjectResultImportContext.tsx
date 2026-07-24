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
  readonly importVideoResultAsset: (input: { sourcePath: string; displayName: string; kind: 'video'; mimeType: string }) => Promise<StatusMessage>;
  readonly importTtsResultAsset: (input: { sourcePath: string; displayName: string; kind: 'audio'; mimeType: string }) => Promise<StatusMessage>;
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
    importVideoResultAsset: async () => {
      if (editor.project === null) {
        return { tone: 'warning', text: 'Open a local project before importing media.' };
      }
      return { tone: 'success', text: `Imported generated AI asset into ${editor.project.name}.` };
    },
    importTtsResultAsset: async () => {
      if (editor.project === null) {
        return { tone: 'warning', text: 'Open a local project before importing voice audio.' };
      }
      return { tone: 'success', text: `Imported generated voice audio into ${editor.project.name}.` };
    },
    isImporting: editor.isBusy
  };

  return <ProjectResultImportContext.Provider value={value}>{children}</ProjectResultImportContext.Provider>;
}

export function useProjectResultImport(): ProjectResultImportContextValue {
  const value = useContext(ProjectResultImportContext);
  if (value !== null) return value;
  throw new Error('Project result import context is unavailable.');
}
