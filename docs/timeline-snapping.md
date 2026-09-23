# Precise clip manipulation

Desktop and mobile use the same magnetic snapping rule for clip moves and
edge trims. Snap targets are the playhead, timeline zero and other clips'
starts/ends across tracks. Moving aligns either end of the clip; trimming
aligns only the dragged edge. Speed-adjusted timeline durations are used.

The attraction distance is eight screen pixels, capped at 250ms at overview
zoom. The moving/trimmed clip is excluded from targets. The existing validators
still reject overlaps and invalid source bounds; snapping never changes those
rules or overwrites a neighbouring clip.

- Desktop: use the snapping toggle, or hold Alt while dropping to bypass it.
- Mobile: use **Snap: On / Snap: Off** in the editing toolbar.
- With snapping off, positions retain millisecond precision rather than a
  100ms or 10ms grid.
- Mobile drag previews follow the finger; magnetic alignment is applied when
  the gesture is released. This change does not add a live snap guide.

Desktop trim-handle drag events no longer bubble into the draggable parent
clip and replace a trim payload with a move payload. Drag grip offsets also
use millisecond precision, avoiding a fixed 100ms offset jump.

## Manual checks

1. Move a clip near another clip's beginning/end; check both leading and
   trailing edge alignment at several zoom levels.
2. Trim an edge near the playhead and another clip edge. Only the intended
   edge should change; the clip should not move as a whole.
3. Disable snapping (and separately try Alt on desktop). Drop between grid
   times; the requested position should not be rounded to 100ms.
4. Try an overlap and out-of-source trim; existing rejection must remain.
5. Undo/redo accepted moves and trims.
6. Repeat on a mobile development client, including pinch zoom and the Snap
   toggle. Native touch behavior requires a device; Node tests and desktop
   browser smoke do not replace that check.
