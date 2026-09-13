import type { AiProjectDocument } from './aiProjectDomain';
import {
  applyWriterPipeline, artifactFromWriterDraft, buildWriterStageRequest, pipelineMatchesBrief,
  saveWriterArtifact, startWriterPipeline
} from './writerPipeline';
import { WRITER_STAGES, canOpenWriterStage, type WriterPipelineState, type WriterStage, type WriterStageArtifact } from './writerStages';
import type { WriterDraft, WriterRequest } from './writerWorkflow';

type WriterHooks = {
  readonly useState: <S>(initial: S | (() => S)) => [S, (next: S | ((previous: S) => S)) => void];
  readonly useRef: <T>(initial: T) => { current: T };
  readonly useEffect: (effect: () => void | (() => void), dependencies: readonly unknown[]) => void;
};

/** Inject each surface's React hooks: Metro must not resolve desktop's React copy. */
export function createUseWriterPipeline({ useEffect, useRef, useState }: WriterHooks) {
return function useWriterPipeline(document: AiProjectDocument, persist: (next: AiProjectDocument) => Promise<boolean>) {
  const [state, setState] = useState<WriterPipelineState | undefined>(document.writerPipeline);
  const [stage, setStageValue] = useState<WriterStage>(() => WRITER_STAGES.find((s) =>
    !document.writerPipeline?.artifacts.some((a) => a.stage === s && a.approved)) ?? 'prompts');
  const [editing, setEditing] = useState<WriterStageArtifact | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [applied, setApplied] = useState(() => document.writerPipeline?.appliedScriptId !== undefined && document.scripts.some((s) => s.id === document.writerPipeline?.appliedScriptId));
  const inFlight = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const savedArtifact = state?.artifacts.find((a) => a.stage === stage) ?? null;
  const artifact = editing ?? savedArtifact;
  const dirty = editing !== null;

  const execute = async (action: () => Promise<void>): Promise<void> => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setMessage('');
    try { await action(); }
    catch (error) { if (mounted.current) setMessage(error instanceof Error ? error.message : 'Writer operation failed.'); }
    finally { inFlight.current = false; if (mounted.current) setBusy(false); }
  };

  const chooseStage = (next: WriterStage): void => {
    if (busy || inFlight.current) return;
    if (dirty) { setMessage('Save or discard the current edits before switching stages.'); return; }
    if (canOpenWriterStage(state ?? { artifacts: [] }, next)) { setStageValue(next); setMessage(''); }
  };

  const generate = (base: WriterRequest, modelId: string, notes: string, generateDraft: (request: WriterRequest) => Promise<WriterDraft>) => execute(async () => {
    if (dirty) throw new Error('Save or discard current edits before generating again.');
    const matches = pipelineMatchesBrief(state, base);
    if (!matches && stage !== 'concept') throw new Error('The brief changed. Return to Develop idea and review the revised pipeline first.');
    const next = matches ? state! : { ...startWriterPipeline(base), artifacts: (state?.artifacts ?? []).map((a) => ({ ...a, approved: false })) };
    const request = buildWriterStageRequest(next, stage, notes, true);
    setMessage(`Writing ${stage}… Only this stage is running.`);
    const draft = await generateDraft(request);
    if (!mounted.current) return;
    setState(next);
    setEditing(artifactFromWriterDraft(stage, draft, modelId));
    setApplied(false);
    setMessage('Draft ready, not saved. Edit it, save a draft, or approve this stage. No next stage runs automatically.');
  });

  const save = (approve: boolean) => execute(async () => {
    if (!state || !artifact) return;
    const next = saveWriterArtifact(state, artifact, approve);
    if (!await persist({ ...document, writerPipeline: next })) throw new Error('Could not save Writer progress. Your edits are still here.');
    if (!mounted.current) return;
    setState(next); setEditing(null); setApplied(false);
    setMessage(approve ? 'Stage approved and saved. Choose the next stage when ready; generating it is a separate action.' : 'Draft saved. This stage and dependent stages require approval before continuing.');
  });

  const apply = () => execute(async () => {
    if (!state || dirty || applied) return;
    const result = applyWriterPipeline(document, state, new Date().toISOString(), `writer-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`);
    if (!result.ok) throw new Error(result.message);
    if (!await persist(result.document)) throw new Error('Could not save production scenes. Try again.');
    if (mounted.current) { setState(result.document.writerPipeline); setApplied(true); setMessage('Production scenes and shots saved. No video was generated or charged. Continue in Video Generation when ready.'); }
  });

  return {
    state, stage, artifact, dirty, busy, message, applied, chooseStage, generate, save, apply, setMessage,
    edit: (changes: Partial<Pick<WriterStageArtifact, 'title' | 'content'>>) => { if (!busy && artifact) setEditing({ ...artifact, ...changes, approved: false }); },
    discard: () => { if (!busy) { setEditing(null); setMessage('Unsaved edits discarded; saved progress is unchanged.'); } }
  };
};
}
