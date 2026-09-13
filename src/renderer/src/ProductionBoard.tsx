import { useState, type ReactElement } from 'react';

import type { AiProjectDocument } from '../../shared/aiProjectDomain';
import {
  activeStyleReference,
  addCharacterReference,
  assignStyleReference,
  assignStoryboardReference,
  buildApprovedProductionAssemblyPlan,
  clearStoryboardReference,
  clearStyleReference,
  missingProductionImageTargets,
  productionShotRows,
  removeCharacterReference,
  type ProductionImageTarget,
  type ProductionMutationResult
} from '../../shared/productionWorkflow';
import type { MediaAsset } from '../../shared/timelineTypes';
import { Button, StatusCard } from './ui';

const STATE_LABELS = {
  not_started: 'Not started', generating: 'Generating', needs_import: 'Needs import',
  needs_review: 'Needs review', approved: 'Approved', failed: 'Failed'
} as const;

export function ProductionBoard({
  document, assets, busy, onSave, onOpenShot, onGenerateCharacterImage, onGenerateStoryboardImage,
  onGenerateImages, onOpenImageResults, onGenerateVideoBatch, onAssemble
}: {
  readonly document: AiProjectDocument;
  readonly assets: readonly MediaAsset[];
  readonly busy: boolean;
  readonly onSave: (document: AiProjectDocument) => Promise<boolean>;
  readonly onOpenShot: (shotId: string) => Promise<void>;
  /** Returns an actionable reason when the image brief cannot be opened. */
  readonly onGenerateCharacterImage: (characterId: string) => string | null;
  readonly onGenerateStoryboardImage: (shotId: string) => string | null;
  readonly onGenerateImages: (targets: readonly ProductionImageTarget[]) => Promise<{ readonly tone: 'neutral' | 'success' | 'warning' | 'danger'; readonly text: string }>;
  readonly onOpenImageResults: () => void;
  readonly onGenerateVideoBatch: () => Promise<{ readonly tone: 'neutral' | 'success' | 'warning' | 'danger'; readonly text: string }>;
  readonly onAssemble: () => boolean;
}): ReactElement | null {
  const [saving, setSaving] = useState(false);
  const [batchBusy, setBatchBusy] = useState(false);
  const [message, setMessage] = useState<{ readonly tone: 'neutral' | 'success' | 'warning' | 'danger'; readonly text: string } | null>(null);
  const rows = productionShotRows(document);
  const activeCharacterIds = new Set(rows.flatMap((row) => row.characterIds));
  const activeCharacters = document.characters.filter((character) => activeCharacterIds.has(character.id));
  const missingCharacterTargets = missingProductionImageTargets(document, 'character_reference');
  const missingStoryboardTargets = missingProductionImageTargets(document, 'storyboard');
  const images = assets.filter((asset) => asset.kind === 'image');
  const imageById = new Map(images.map((asset) => [asset.id, asset]));
  const referenceById = new Map(document.referenceAssets.map((entry) => [entry.id, entry]));
  const styleReference = activeStyleReference(document);
  const assembly = buildApprovedProductionAssemblyPlan(document, assets.map((asset) => ({
    id: asset.id, kind: asset.kind, durationMs: asset.metadata?.durationMs ?? null
  })));
  if (rows.length === 0) return null;

  const runImages = async (targets: readonly ProductionImageTarget[]): Promise<void> => {
    setBatchBusy(true);
    setMessage({ tone: 'neutral', text: `Starting ${targets.length} production image job(s). Open Image Generation to watch results; the queue continues one at a time.` });
    try {
      setMessage(await onGenerateImages(targets));
    } catch (error: unknown) {
      setMessage({ tone: 'danger', text: error instanceof Error ? error.message : 'The production image queue failed.' });
    } finally {
      setBatchBusy(false);
    }
  };

  const runVideoBatch = async (): Promise<void> => {
    setBatchBusy(true);
    setMessage({ tone: 'neutral', text: 'Preparing eligible Writer shots, reference inputs and the batch cost confirmation.' });
    try {
      setMessage(await onGenerateVideoBatch());
    } catch (error: unknown) {
      setMessage({ tone: 'danger', text: error instanceof Error ? error.message : 'The production video queue failed.' });
    } finally {
      setBatchBusy(false);
    }
  };

  const persist = async (result: ProductionMutationResult, success: string): Promise<void> => {
    if (!result.ok) {
      setMessage({ tone: 'warning', text: result.reason });
      return;
    }
    setSaving(true);
    try {
      const saved = await onSave(result.document);
      setMessage(saved
        ? { tone: 'success', text: success }
        : { tone: 'danger', text: 'The production mapping could not be saved. No provider job was started.' });
    } catch (error) {
      setMessage({
        tone: 'danger',
        text: `The production mapping could not be saved: ${error instanceof Error ? error.message : 'Unknown error'}. No provider job was started.`
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="production-board" aria-labelledby="production-board-title">
      <header className="production-board__header">
        <div>
          <h3 id="production-board-title">Storyboard production board</h3>
          <p>Map existing images, edit a brief, or start a provider job here. Batch queues run one target at a time and never approve or attach a result automatically. Current video modes send either the storyboard first frame or the character-reference set, not both.</p>
        </div>
        <StatusCard tone={assembly.ok ? 'success' : 'neutral'}>{rows.filter((row) => row.state === 'approved').length}/{rows.length} shots approved</StatusCard>
      </header>

      {message !== null && <StatusCard tone={message.tone}>{message.text}</StatusCard>}

      <div className="production-board__characters">
        <h4>World/style reference</h4>
        <p>Choose one approved image as the visual source of truth for every character sheet and storyboard frame in this project. It is attached first; up to two character images fill the remaining provider reference slots.</p>
        <select
          aria-label="World and visual style reference"
          disabled={busy || saving || batchBusy || images.length === 0}
          value={styleReference?.assetId ?? ''}
          onChange={(event) => {
            const asset = imageById.get(event.target.value);
            void persist(asset === undefined
              ? clearStyleReference(document)
              : assignStyleReference(document, {
                assetId: asset.id,
                referenceId: `style-reference-${crypto.randomUUID()}`,
                label: `World style · ${asset.displayName}`
              }), asset === undefined
                ? 'Cleared the world/style reference.'
                : `${asset.displayName} is now the world/style reference for this project.`);
          }}
        >
          <option value="">{images.length === 0 ? 'Import a style image in Editing first' : 'No world/style image'}</option>
          {images.map((asset) => <option key={asset.id} value={asset.id}>{asset.displayName}</option>)}
        </select>
      </div>

      <div className="production-board__characters">
        <h4>Character reference library</h4>
        {activeCharacters.length === 0 && <span>This Writer version has no named characters.</span>}
        {activeCharacters.map((character) => {
          const assigned = character.referenceAssetIds.map((id) => ({ id, reference: referenceById.get(id) })).filter((entry) => entry.reference?.role === 'character');
          return <div className="production-board__character" key={character.id}>
            <strong>{character.name}</strong>
            <span>{character.invariantDescription}</span>
            <div className="production-board__reference-list">
              {assigned.map(({ id, reference }) => <span className="production-board__reference" key={id}>
                {imageById.get(reference!.assetId)?.displayName ?? reference!.label}
                <button type="button" disabled={busy || saving} aria-label={`Remove ${reference!.label} from ${character.name}`}
                  onClick={() => void persist(removeCharacterReference(document, character.id, id), `Removed a reference from ${character.name}.`)}>×</button>
              </span>)}
              <select aria-label={`Add image reference for ${character.name}`} disabled={busy || saving || assigned.length >= 3 || images.length === 0} value=""
                onChange={(event) => {
                  const asset = imageById.get(event.target.value);
                  if (asset === undefined) return;
                  void persist(addCharacterReference(document, {
                    characterId: character.id, assetId: asset.id,
                    referenceId: `character-reference-${crypto.randomUUID()}`,
                    label: `${character.name} · ${asset.displayName}`
                  }), `Assigned ${asset.displayName} to ${character.name}.`);
                }}>
                <option value="">{images.length === 0 ? 'Import images in Editing first' : 'Add project image…'}</option>
                {images.map((asset) => <option key={asset.id} value={asset.id}>{asset.displayName}</option>)}
              </select>
              <Button
                variant="ghost"
                disabled={busy || saving || batchBusy || assigned.length >= 3}
                onClick={() => {
                  const reason = onGenerateCharacterImage(character.id);
                  if (reason !== null) setMessage({ tone: 'warning', text: reason });
                }}
              >Edit reference brief</Button>
              <Button
                variant="primary"
                disabled={busy || saving || batchBusy || assigned.length >= 3}
                onClick={() => void runImages([{ kind: 'character_reference', characterId: character.id }])}
              >Generate now</Button>
            </div>
          </div>;
        })}
      </div>

      <ol className="production-board__shots">
        {rows.map((row, index) => <li className="production-board__shot" key={row.shotId}>
          <div className="production-board__shot-heading">
            <span className="production-board__number">{String(index + 1).padStart(2, '0')}</span>
            <div><strong>{row.label}</strong><span>{row.sceneTitle} · {(row.durationMs / 1_000).toFixed(1)}s · {row.candidateCount} candidate(s) · {row.characterReferenceIds.length} character reference(s)</span></div>
            <span className={`production-board__state production-board__state--${row.state}`}>{STATE_LABELS[row.state]}</span>
          </div>
          <label className="studio-field">
            <span className="studio-field__label">Storyboard / first frame</span>
            <select disabled={busy || saving || images.length === 0} value={row.storyboardReference?.assetId ?? ''} onChange={(event) => {
              const asset = imageById.get(event.target.value);
              void persist(asset === undefined
                ? clearStoryboardReference(document, row.shotId)
                : assignStoryboardReference(document, {
                  shotId: row.shotId, assetId: asset.id,
                  referenceId: `storyboard-reference-${crypto.randomUUID()}`,
                  label: `Storyboard · ${row.label} · ${asset.displayName}`
                }), asset === undefined ? `Cleared the storyboard image for ${row.label}.` : `Mapped ${asset.displayName} to ${row.label}.`);
            }}>
              <option value="">{images.length === 0 ? 'Import storyboard images in Editing first' : 'No storyboard image'}</option>
              {images.map((asset) => <option key={asset.id} value={asset.id}>{asset.displayName}</option>)}
            </select>
          </label>
          <div className="production-board__shot-actions">
            <Button variant="ghost" disabled={busy || saving || batchBusy} onClick={() => {
              const reason = onGenerateStoryboardImage(row.shotId);
              if (reason !== null) setMessage({ tone: 'warning', text: reason });
            }}>Edit storyboard brief</Button>
            <Button variant="primary" disabled={busy || saving || batchBusy} onClick={() => void runImages([{ kind: 'storyboard', shotId: row.shotId }])}>Generate image now</Button>
            <Button variant="ghost" disabled={busy || saving || batchBusy} onClick={() => void onOpenShot(row.shotId)}>Open shot for video</Button>
          </div>
        </li>)}
      </ol>

      {!assembly.ok && <StatusCard tone="neutral">Assembly blocked: {assembly.reason}</StatusCard>}
      <div className="production-board__actions">
        <Button variant="default" disabled={busy || saving || batchBusy || missingCharacterTargets.length === 0}
          onClick={() => void runImages(missingCharacterTargets)}>
          Generate missing character images
        </Button>
        <Button variant="default" disabled={busy || saving || batchBusy || missingStoryboardTargets.length === 0}
          onClick={() => void runImages(missingStoryboardTargets)}>
          Generate missing storyboards
        </Button>
        <Button variant="default" disabled={busy || saving || batchBusy} onClick={() => void runVideoBatch()}>
          Generate production videos
        </Button>
        <Button variant="ghost" onClick={onOpenImageResults}>Review image results</Button>
        <Button variant="primary" disabled={busy || saving || !assembly.ok} onClick={() => {
          const assembled = onAssemble();
          setMessage({ tone: assembled ? 'success' : 'warning', text: assembled
            ? `Placed ${rows.length} approved shots on the timeline in Writer order. Save and review the cut before export.`
            : 'The cut was not assembled. Check the Editing status for the exact conflict.' });
        }}>Assemble approved shots on timeline</Button>
        <span>Generation requires confirmation; approval, attachment, replacement and export stay manual.</span>
      </div>
    </section>
  );
}
