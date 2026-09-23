import type { AiProjectDocument } from './aiProjectDomain';
import type { WriterDraft, WriterRequest } from './writerWorkflow';
import type { WriterPipelineState } from './writerStages';
import { approveProductionPlan, proposeProductionPlan } from './productionPlan';

type Hooks = {
  useState: <S>(initial: S | (() => S)) => [S, (next: S | ((previous: S) => S)) => void];
  useRef: <T>(initial: T) => { current: T };
  useEffect: (effect: () => void | (() => void), deps: readonly unknown[]) => void;
};
export function createUseProductionPlan({ useState, useRef, useEffect }: Hooks) {
  return function useProductionPlan(document: AiProjectDocument, persist: (next: AiProjectDocument) => Promise<boolean>) {
    const latest = useRef(document); latest.current = document;
    const mounted = useRef(true);
    useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
    const lock = useRef(false);
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState('');
    const [unsaved, setUnsaved] = useState<WriterPipelineState | null>(null);
    const proposal = unsaved ?? document.writerPipeline;
    const run = async (action: () => Promise<void>) => {
      if (lock.current) return;
      lock.current = true; setBusy(true); setMessage('');
      try { await action(); } catch (error) { if (mounted.current) setMessage(error instanceof Error ? error.message : 'Production planning failed.'); }
      finally { lock.current = false; if (mounted.current) setBusy(false); }
    };
    return { busy, message, proposal, unsaved: unsaved !== null,
      generate: (request: WriterRequest, modelId: string, generate: (request: WriterRequest) => Promise<WriterDraft>) => run(async () => {
        const before = JSON.stringify(latest.current.writerPipeline);
        const next = proposeProductionPlan(request, await generate(request), modelId);
        if (!mounted.current) return;
        setUnsaved(next);
        if (JSON.stringify(latest.current.writerPipeline) !== before) throw new Error('The plan changed during generation. New proposal kept unsaved; review before replacing.');
        if (!await persist({ ...latest.current, writerPipeline: next })) throw new Error('Plan could not be saved. The proposal is retained; retry saving it.');
        if (mounted.current) { setUnsaved(null); setMessage('Plan saved for review. No images, video or speech generated.'); }
      }),
      saveDraft: () => run(async () => {
        if (!unsaved) return;
        if (!await persist({ ...latest.current, writerPipeline: unsaved })) throw new Error('Could not save proposal.');
        if (mounted.current) { setUnsaved(null); setMessage('Proposal saved for review.'); }
      }),
      approve: (request: WriterRequest) => run(async () => {
        if (!proposal || unsaved) throw new Error('Save the proposal before approving it.');
        if (JSON.stringify(proposal) !== JSON.stringify(latest.current.writerPipeline)) throw new Error('The plan changed. Review the latest version.');
        const next = approveProductionPlan(latest.current, request, proposal, new Date().toISOString(), `production-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`);
        if (!await persist(next)) throw new Error('Approval could not be saved. No generation started.');
        if (mounted.current) setMessage('Plan approved and shots prepared. Next: review generation settings and approve the batch cost.');
      })
    };
  };
}
