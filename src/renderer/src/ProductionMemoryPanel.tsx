import { useMemo, useState } from 'react';
import type { AiProjectDocument } from '../../shared/aiProjectDomain';
import { appendProductionMemory, buildProductionMemory, searchProductionMemory } from '../../shared/productionMemory';
import { Button } from './ui';

export function ProductionMemoryPanel({ projectId, document, prompt, onChange, disabled }: {
  readonly projectId: string; readonly document: AiProjectDocument; readonly prompt: string;
  readonly onChange: (value: string) => void; readonly disabled: boolean;
}) {
  const [query, setQuery] = useState('');
  const [message, setMessage] = useState('');
  const index = useMemo(() => buildProductionMemory(projectId, document), [projectId, document]);
  const results = useMemo(() => searchProductionMemory(index, projectId, query), [index, projectId, query]);
  return <details className="production-memory">
    <summary>Project memory · local search</summary>
    <p>Search stays on this device. Added references become editable prompt text and will be sent to the selected provider when you generate. Review them again if the source changes.</p>
    <label>Find dialogue, characters or previous prompts
      <input value={query} maxLength={512} onChange={event => setQuery(event.target.value)} placeholder="Character name, dialogue or scene…" />
    </label>
    <p>{index.entries.length} indexed excerpts · up to 5 matches · lexical search, not semantic search.</p>
    {index.truncated && <p>Index limit reached. Only the first 256 excerpts, up to 12,000 characters per source, are searchable.</p>}
    {query.trim() && results.length === 0 && <p>No matching current project material. Approve the script before searching production shots.</p>}
    <div style={{ maxHeight: 220, overflowY: 'auto' }}>
      {results.map(entry => <article key={entry.sourceId}>
        <strong>{entry.title}</strong><p><code>{entry.sourceId}</code></p>
        <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{entry.text}</p>
        <Button disabled={disabled} onClick={() => {
          const result = appendProductionMemory(prompt, entry, projectId);
          if (result.ok) { onChange(result.prompt); setMessage('Reference copied to the prompt. Review before generating; remove it by editing the prompt.'); }
          else setMessage(result.reason);
        }}>Add reference to prompt</Button>
      </article>)}
    </div>
    <p role="status">{message}</p>
  </details>;
}
