import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  deleteClip,
  moveClip,
  placeClip,
  splitClip,
  trimClipLeft,
  trimClipRight,
  updateClipEffects
} from '@openvideo/shared/timelineClipLogic';
import { addTrack, createInitialTimeline, removeTrack, timelineDurationMs } from '@openvideo/shared/timelineLogic';
import { updateAudioTrackMix } from '@openvideo/shared/timelineMetadataLogic';
import { resolveVisibleClip } from '@openvideo/shared/timelinePlayback';
import {
  cutNearest,
  removeTransitionAtCut,
  setTransitionAtCut,
  transitionForCut
} from '@openvideo/shared/timelineTransitionLogic';
import type { ClipEffects } from '@openvideo/shared/timelineTypes';
import { DEFAULT_CLIP_EFFECTS } from '@openvideo/shared/timelineTypes';
import { resolveTimelineTrackForAsset, trackAppendStartMs } from '@openvideo/shared/timelineClipPlacement';
import type { MediaAsset, TimelineDocument, TransitionType } from '@openvideo/shared/timelineTypes';

/**
 * The editing model is the desktop's, unchanged — every operation below is a
 * pure function from src/shared. Nothing here reimplements a rule; this hook only
 * owns what the desktop's own editor hook owns: which clip is selected, where the
 * playhead is, and the undo stack.
 */

export type EditorAsset = MediaAsset & { readonly uri: string };

type Snapshot = { readonly timeline: TimelineDocument; readonly label: string };

const UNDO_DEPTH = 40;

export function useMobileEditor(persist?: (timeline: TimelineDocument) => void) {
  const [timeline, setTimeline] = useState<TimelineDocument>(() => createInitialTimeline());
  const [assets, setAssets] = useState<readonly EditorAsset[]>([]);
  const loadProject = useCallback((next: TimelineDocument, nextAssets: readonly EditorAsset[]): void => {
    setTimeline(next);
    setAssets(nextAssets);
    setSelectedClipId(null);
    setPlayheadMs(0);
    // Undo does not cross projects: stepping back into another project's
    // timeline would be nonsense.
    setPast([]);
    setFuture([]);
  }, []);
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const [playheadMs, setPlayheadMs] = useState(0);
  const [past, setPast] = useState<readonly Snapshot[]>([]);
  const [future, setFuture] = useState<readonly Snapshot[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  /** The last accepted timeline waiting to be written; see the effect below. */
  const pending = useRef<TimelineDocument | null>(null);

  const durationMs = useMemo(() => timelineDurationMs(timeline), [timeline]);

  /**
   * Every mutation goes through here, so an operation the shared rules reject
   * leaves the document untouched and says why — rather than silently doing
   * nothing, which on a touch screen reads as a missed tap.
   */
  const apply = useCallback(
    (label: string, update: (current: TimelineDocument) => TimelineDocument | null, rejection: string): void => {
      setTimeline((current) => {
        const next = update(current);
        if (next === null) {
          setMessage(rejection);
          return current;
        }
        setPast((stack) => [...stack, { timeline: current, label }].slice(-UNDO_DEPTH));
        setFuture([]);
        setMessage(null);
        // Handed to the effect below rather than written here. React runs an
        // updater during render, and this used to write the file and notify
        // every subscriber from inside one — which updated the shell while
        // another component was rendering, and would write twice under a double
        // invocation. A ref is safe to set from an updater because setting it
        // twice to the same value is the same as setting it once.
        pending.current = next;
        return next;
      });
    },
    []
  );

  /*
    Written on every accepted edit rather than on a save button: a phone app is
    backgrounded and killed without warning, and an explicit save is a thing to
    forget. After the render rather than during it, and only for an edit that
    was accepted — persisting on every render would write the empty starting
    timeline over a stored project the moment the editor mounted.
  */
  useEffect(() => {
    const next = pending.current;
    if (next === null) return;
    pending.current = null;
    persist?.(next);
  });

  const undo = useCallback(() => {
    setPast((stack) => {
      const previous = stack[stack.length - 1];
      if (previous === undefined) return stack;
      setTimeline((current) => {
        setFuture((forward) => [{ timeline: current, label: previous.label }, ...forward]);
        return previous.timeline;
      });
      return stack.slice(0, -1);
    });
  }, []);

  const redo = useCallback(() => {
    setFuture((stack) => {
      const next = stack[0];
      if (next === undefined) return stack;
      setTimeline((current) => {
        setPast((back) => [...back, { timeline: current, label: next.label }]);
        return next.timeline;
      });
      return stack.slice(1);
    });
  }, []);

  const addAsset = useCallback(
    (asset: EditorAsset): void => {
      setAssets((current) => [...current, asset]);
      apply(
        `Added ${asset.displayName}`,
        (current) => {
          const target = resolveTimelineTrackForAsset(current, asset);
          if (!target.ok) return null;
          const durationMsForAsset = asset.metadata?.durationMs ?? 5_000;
          // Appended rather than dropped at the playhead: there is no cursor to
          // drop onto on a phone, and appending is never ambiguous.
          return placeClip(current, {
            trackId: target.track.id,
            clip: {
              id: `clip-${asset.id}-${Date.now().toString(36)}`,
              assetId: asset.id,
              timelineStartMs: trackAppendStartMs(target.track),
              sourceStartMs: 0,
              sourceEndMs: durationMsForAsset,
              sourceDurationMs: durationMsForAsset,
              effects: { ...DEFAULT_CLIP_EFFECTS },
              keyframes: []
            }
          });
        },
        'That asset could not be placed on a track.'
      );
    },
    [apply, persist]
  );

  /** What the preview should be showing right now. */
  const visible = useMemo(() => resolveVisibleClip(timeline, playheadMs), [timeline, playheadMs]);

  /**
   * Places an asset that is already in the project on the timeline.
   *
   * `addAsset` both registers and places, which is right for an import. Using it
   * from the media library would register a second copy of an asset the project
   * already holds.
   */
  const placeExisting = useCallback(
    (assetId: string): void => {
      apply(
        'Add to timeline',
        (current) => {
          const asset = assets.find((candidate) => candidate.id === assetId);
          if (asset === undefined) return null;
          const target = resolveTimelineTrackForAsset(current, asset);
          if (!target.ok) return null;
          const durationMsForAsset = asset.metadata?.durationMs ?? 5_000;
          return placeClip(current, {
            trackId: target.track.id,
            clip: {
              id: `clip-${asset.id}-${Date.now().toString(36)}`,
              assetId: asset.id,
              timelineStartMs: trackAppendStartMs(target.track),
              sourceStartMs: 0,
              sourceEndMs: durationMsForAsset,
              sourceDurationMs: durationMsForAsset,
              effects: { ...DEFAULT_CLIP_EFFECTS },
              keyframes: []
            }
          });
        },
        'That asset could not be placed on a track.'
      );
    },
    [apply, assets]
  );

  const selectedClip = useMemo(() => {
    for (const track of timeline.tracks) {
      const clip = track.clips.find((candidate) => candidate.id === selectedClipId);
      if (clip !== undefined) return { clip, trackId: track.id };
    }
    return null;
  }, [timeline, selectedClipId]);

  return {
    timeline,
    assets,
    loadProject,
    durationMs,
    playheadMs,
    setPlayheadMs,
    selectedClipId,
    setSelectedClipId,
    selectedClip,
    visible,
    message,
    canUndo: past.length > 0,
    canRedo: future.length > 0,
    undo,
    redo,
    addAsset,
    placeExisting,
    assetFor: (assetId: string) => assets.find((asset) => asset.id === assetId) ?? null,

    splitAtPlayhead: () =>
      apply(
        'Split',
        (current) =>
          selectedClipId === null
            ? null
            : splitClip(current, {
                clipId: selectedClipId,
                atMs: playheadMs,
                rightClipId: `clip-split-${Date.now().toString(36)}`
              }),
        'Move the playhead inside the selected clip to split it.'
      ),

    deleteSelected: () =>
      apply(
        'Delete',
        // deleteClip returns a document rather than null, and no-ops on an
        // unknown id, so the guard is ours to make.
        (current) => (selectedClipId === null ? null : deleteClip(current, selectedClipId)),
        'Select a clip first.'
      ),

    trimSelected: (edge: 'left' | 'right', deltaMs: number) =>
      apply(
        `Trim ${edge}`,
        (current) => {
          if (selectedClip === null) return null;
          const at = edge === 'left'
            ? selectedClip.clip.timelineStartMs + deltaMs
            : selectedClip.clip.timelineStartMs +
              (selectedClip.clip.sourceEndMs - selectedClip.clip.sourceStartMs) +
              deltaMs;
          return edge === 'left'
            ? trimClipLeft(current, { clipId: selectedClip.clip.id, timelineStartMs: at })
            : trimClipRight(current, { clipId: selectedClip.clip.id, timelineEndMs: at });
        },
        'That trim would make the clip shorter than a frame.'
      ),

    nudgeSelected: (deltaMs: number) =>
      apply(
        'Move',
        (current) => {
          if (selectedClip === null) return null;
          return moveClip(current, {
            clipId: selectedClip.clip.id,
            targetTrackId: selectedClip.trackId,
            timelineStartMs: Math.max(0, selectedClip.clip.timelineStartMs + deltaMs)
          });
        },
        'That move would overlap another clip.'
      ),

    /**
     * Absolute placement, for dragging.
     *
     * A drag knows where the finger ended, not how far it travelled from the
     * last committed position — accumulating deltas across a gesture drifts,
     * and every rejected intermediate move would drift it further.
     */
    moveClipTo: (clipId: string, trackId: string, timelineStartMs: number) =>
      apply(
        'Move',
        (current) => moveClip(current, { clipId, targetTrackId: trackId, timelineStartMs: Math.max(0, Math.round(timelineStartMs)) }),
        'That move would overlap another clip.'
      ),

    /** Absolute trim, for dragging a clip edge. */
    trimClipTo: (clipId: string, edge: 'left' | 'right', timelineMs: number) =>
      apply(
        `Trim ${edge}`,
        (current) => {
          const at = Math.max(0, Math.round(timelineMs));
          return edge === 'left'
            ? trimClipLeft(current, { clipId, timelineStartMs: at })
            : trimClipRight(current, { clipId, timelineEndMs: at });
        },
        'That trim would make the clip shorter than a frame.'
      ),

    setSelectedEffects: (effects: Partial<ClipEffects>) =>
      apply(
        'Adjust',
        (current) =>
          selectedClip === null
            ? null
            : updateClipEffects(current, {
                clipId: selectedClip.clip.id,
                effects: { ...selectedClip.clip.effects, ...effects }
              }),
        'That value is outside what the effect accepts.'
      ),

    setTrackMuted: (trackId: string, muted: boolean) =>
      apply(
        muted ? 'Mute' : 'Unmute',
        (current) => {
          const track = current.tracks.find((candidate) => candidate.id === trackId);
          if (track === undefined || track.kind !== 'audio') return null;
          return updateAudioTrackMix(current, { trackId, mix: { ...track.mix, muted } });
        },
        'Only audio tracks carry a mix.'
      ),

    setTrackGainDb: (trackId: string, gainDb: number) =>
      apply(
        'Track gain',
        (current) => {
          const track = current.tracks.find((candidate) => candidate.id === trackId);
          if (track === undefined || track.kind !== 'audio') return null;
          return updateAudioTrackMix(current, { trackId, mix: { ...track.mix, gainDb } });
        },
        'Only audio tracks carry a mix.'
      ),

    addTrack: (kind: 'video' | 'audio') =>
      apply(
        'Add track',
        (current) => {
          const existing = current.tracks.filter((track) => track.kind === kind).length + 1;
          return addTrack(current, {
            id: `${kind}-${Date.now().toString(36)}`,
            kind,
            name: `${kind === 'video' ? 'Video' : 'Audio'} ${existing}`
          });
        },
        'That track could not be added.'
      ),

    removeTrack: (trackId: string) =>
      apply(
        'Remove track',
        (current) => removeTrack(current, trackId),
        'A timeline keeps at least one video and one audio track.'
      ),

    /*
      Transitions.

      Between two clips, so nothing on the lanes can be tapped to mean one — the
      playhead near a cut is the whole address. A phone gets a wider tolerance
      than a mouse would need, because a finger is worth tens of milliseconds.
    */
    cutAtPlayhead: cutNearest(timeline, playheadMs, 500),

    transitionAtPlayhead: (() => {
      const cut = cutNearest(timeline, playheadMs, 500);
      return cut === null ? null : transitionForCut(timeline, cut);
    })(),

    setTransition: (type: TransitionType, durationMs?: number) => {
      const cut = cutNearest(timeline, playheadMs, 500);
      if (cut === null) return;
      apply(
        'Transition',
        (current) =>
          setTransitionAtCut(current, cut, durationMs === undefined ? { type } : { type, durationMs }),
        'A transition has to fit inside both of the clips it joins.'
      );
    },

    removeTransition: () => {
      const cut = cutNearest(timeline, playheadMs, 500);
      if (cut === null) return;
      apply('Remove transition', (current) => removeTransitionAtCut(current, cut), 'That transition could not be removed.');
    }
  };
}
