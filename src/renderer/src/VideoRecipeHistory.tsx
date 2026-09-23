import { useEffect, useState } from 'react';
import type { VideoRecipe } from '../../shared/videoRecipeHistory';
import { Button } from './ui';
function StoredVideo({ projectId, assetId }: { projectId: string; assetId: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true; setUrl(null);
    void window.videoTool.getAssetPlaybackUrl({ projectId, assetId }).then(result => {
      if (alive && result.ok) setUrl(result.value.url);
    }).catch(() => {});
    return () => { alive = false; };
  }, [projectId, assetId]);
  return url === null ? <p>Preview unavailable; the saved prompt can still be reused.</p> : <video src={url} controls preload="metadata" style={{ maxWidth: '100%', maxHeight: 180 }} />;
}
export function VideoRecipeHistory({ projectId, records, assetIds, disabled, onReuse }: {
  projectId: string; records: readonly VideoRecipe[]; assetIds: readonly string[];
  disabled: boolean; onReuse: (recipe: VideoRecipe) => void;
}) {
  const [open, setOpen] = useState(false);
  const [visibleCount, setVisibleCount] = useState(20);
  return <details onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>Saved videos & prompts ({records.length})</summary>
    <p>Reuse loads the exact saved prompt only. Review the original settings below and reselect model, length and reference media before Generate. A new generation costs separately and never replaces the original.</p>
    {open && <div style={{ maxHeight: 320, overflowY: 'auto' }}>
      {records.slice(-visibleCount).reverse().map(recipe => <article key={recipe.id}>
        <strong>{recipe.modelId} · {recipe.durationSeconds}s · {recipe.aspectRatio} · {recipe.operation}</strong>
        <p>{recipe.createdAt}{recipe.parentId ? ' · Based on ' + recipe.parentId : ''}</p>
        {assetIds.includes(recipe.assetId) ? <StoredVideo projectId={projectId} assetId={recipe.assetId} /> : <p>Media removed. Prompt retained.</p>}
        <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{recipe.prompt}</pre>
        <Button disabled={disabled} onClick={() => onReuse(recipe)}>Prepare regeneration</Button>
      </article>)}
      {visibleCount < records.length && <Button onClick={() => setVisibleCount(value => value + 20)}>Show older videos</Button>}
    </div>}
  </details>;
}
