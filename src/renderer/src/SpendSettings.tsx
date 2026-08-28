import { useCallback, useEffect, useState, type ReactElement } from 'react';

import { describeSpend, type GenerationSpendView } from '../../shared/generationSpend';
import { Button, MetadataList, StatusCard } from './ui';

/**
 * The ceiling on what generation may cost, and what it has cost so far.
 *
 * Setting it is here rather than among the agent's tools on purpose: an agent
 * that can raise its own limit does not have one.
 */

const EMPTY: GenerationSpendView = { total: { amountUsd: 0, entryCount: 0, unpricedCount: 0 } };

export function SpendSettings(): ReactElement {
  const [view, setView] = useState<GenerationSpendView>(EMPTY);
  const [draft, setDraft] = useState('');
  const [failure, setFailure] = useState('');

  useEffect(() => {
    let cancelled = false;
    void window.videoTool.getGenerationSpend().then((response) => {
      if (cancelled || !response.ok) return;
      setView(response.value);
      setDraft(response.value.capUsd === undefined ? '' : String(response.value.capUsd));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const apply = useCallback(async (capUsd: number | null) => {
    setFailure('');
    const response = await window.videoTool.setGenerationSpendCap(capUsd);
    if (response.ok) {
      setView(response.value);
      setDraft(response.value.capUsd === undefined ? '' : String(response.value.capUsd));
      return;
    }
    setFailure(response.error.message);
  }, []);

  const save = useCallback(() => {
    const trimmed = draft.trim();
    if (trimmed.length === 0) {
      void apply(null);
      return;
    }
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      // Refused rather than rounded into something: a limit nobody meant is
      // worse than no limit, because it is trusted.
      setFailure('A monthly limit has to be a number of dollars greater than zero. Leave it empty for no limit.');
      return;
    }
    void apply(parsed);
  }, [apply, draft]);

  return (
    <>
      <MetadataList
        items={[
          { term: 'This month', description: describeSpend(view.total, view.capUsd) },
          {
            term: 'Counted',
            description: 'Video, image, and speech jobs sent to a provider. Local generation costs nothing and is not counted.'
          },
          {
            term: 'Unknown rates',
            description:
              'A model with no recorded price cannot be kept under a limit, so with one set it is refused unless the charge is accepted deliberately.'
          }
        ]}
      />
      <div className="field">
        <label className="field-label" htmlFor="spend-cap">Monthly limit (USD)</label>
        <input
          id="spend-cap"
          type="number"
          min="0"
          step="1"
          placeholder="No limit"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
      </div>
      {failure.length > 0 ? <StatusCard tone="danger">{failure}</StatusCard> : null}
      <StatusCard tone={view.capUsd === undefined ? 'warning' : 'neutral'}>
        {view.capUsd === undefined
          ? 'No limit is set, so nothing bounds what generation can spend once a provider is connected.'
          : `Jobs that would take this month past $${view.capUsd.toFixed(2)} are refused before they reach a provider.`}
      </StatusCard>
      <Button variant="default" onClick={save}>Save limit</Button>
    </>
  );
}
