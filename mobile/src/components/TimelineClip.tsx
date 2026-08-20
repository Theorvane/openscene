import { useMemo, useRef } from 'react';
import { Animated, Image, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector, type GestureType } from 'react-native-gesture-handler';

import type { PersistedTimelineClip } from '@openvideo/shared/timelineTypes';
import { clipDurationMs } from '@openvideo/shared/timelineClipGeometry';
import { handleWidthFor, MIN_CLIP_WIDTH } from '../lib/timelineHandles';
import { useClipThumbnails } from '../lib/thumbnails';
import { theme } from '../lib/theme';

/**
 * A clip you drag, rather than nudge.
 *
 * The gesture is declared to the gesture handler rather than negotiated through
 * `PanResponder`, because the two answers were not the same twice. Inside a
 * horizontal `ScrollView`, the responder system and Android's native scroll
 * interception each decided who won the drag, and the outcome varied between
 * identical gestures: one drag moved the clip, the next scrolled the timeline
 * and left the clip alone. In an editor that is fatal — a drag meant to trim
 * scrolls the view, and a drag meant to scroll edits the cut.
 *
 * `blocksExternalGesture` states the precedence once: while this pan is active,
 * the scroller does not move. Nothing is left to arbitration.
 *
 * Everything is previewed with a transform and committed once on release: the
 * shared rules can reject an intermediate position mid-drag, and re-rendering
 * the document at finger rate would fight the gesture.
 */

export function TimelineClip({
  clip,
  label,
  kind,
  assetUri,
  still,
  selected,
  pxPerMs,
  scrollGesture,
  onSelect,
  onMove,
  onTrim,
  onDragStateChange
}: {
  readonly clip: PersistedTimelineClip;
  readonly label: string;
  readonly kind: 'video' | 'audio';
  /** Where the clip's media lives, for the frames drawn along it. Null while it loads. */
  readonly assetUri?: string | null;
  /** A still has no frames to decode — it is already the picture. */
  readonly still?: boolean;
  readonly selected: boolean;
  readonly pxPerMs: number;
  /** The lane scroller's gesture, so a drag on a clip can state that it outranks scrolling. */
  readonly scrollGesture: GestureType;
  readonly onSelect: () => void;
  readonly onMove: (timelineStartMs: number) => void;
  readonly onTrim: (edge: 'left' | 'right', timelineMs: number) => void;
  /** Lets the screen freeze the scroll view for the duration of a drag. */
  readonly onDragStateChange: (dragging: boolean) => void;
}) {
  // How long it sits on the timeline, which at anything but 1× is not the
  // same as how much source it uses.
  const lengthMs = clipDurationMs(clip);
  const width = Math.max(MIN_CLIP_WIDTH, lengthMs * pxPerMs);
  const handle = handleWidthFor(width);
  /*
    Audio has no picture, and a still is already one — decoding a PNG to show it
    to itself is work for nothing, so the image is drawn directly.
  */
  const decoded = useClipThumbnails({
    assetId: clip.assetId,
    uri: kind === 'video' && still !== true ? assetUri ?? null : null,
    clip,
    widthPx: width
  });
  const thumbnails = kind === 'video' && still === true && assetUri != null ? [assetUri] : decoded;

  /*
    Plain `Animated`, driven from the gesture's callbacks.

    Without Reanimated installed the gesture handler runs its callbacks on the JS
    thread, which is where these values live anyway — and a second native
    dependency for a preview transform is not a trade worth making.
  */
  const offset = useRef(new Animated.Value(0)).current;
  const stretch = useRef(new Animated.Value(0)).current;
  const edge = useRef<'move' | 'left' | 'right'>('move');

  const tap = useMemo(() => Gesture.Tap().onEnd(() => onSelect()), [onSelect]);

  const pan = useMemo(
    () =>
      Gesture.Pan()
        /*
          Any clip takes the drag, selected or not.

          Tap-to-select-then-drag existed because the gesture was contested: if
          clips always claimed the touch, a timeline wider than the screen could
          not be scrolled by dragging over the clips filling it. Precedence is
          declared now, so the finger that lands on a clip moves that clip —
          which is what a phone editor does — and scrolling is the drag that
          starts anywhere else.
        */
        .blocksExternalGesture(scrollGesture)
        // A tap must stay a tap: selection is the common action, so a gesture
        // only becomes a drag once it has clearly travelled.
        .activeOffsetX([-6, 6])
        .runOnJS(true)
        .onBegin((event) => {
          edge.current = event.x < handle ? 'left' : event.x > width - handle ? 'right' : 'move';
          // Dragging a clip is also a way of choosing it, so the panels above
          // follow the finger rather than waiting for a separate tap.
          if (!selected) onSelect();
          onDragStateChange(true);
        })
        .onUpdate((event) => {
          if (edge.current === 'move') offset.setValue(event.translationX);
          else stretch.setValue(event.translationX);
        })
        .onEnd((event) => {
          const deltaMs = event.translationX / pxPerMs;
          if (edge.current === 'move') onMove(clip.timelineStartMs + deltaMs);
          else if (edge.current === 'left') onTrim('left', clip.timelineStartMs + deltaMs);
          else onTrim('right', clip.timelineStartMs + lengthMs + deltaMs);
        })
        .onFinalize(() => {
          offset.setValue(0);
          stretch.setValue(0);
          onDragStateChange(false);
        }),
    [selected, onSelect, scrollGesture, handle, width, pxPerMs, clip.timelineStartMs, lengthMs, onMove, onTrim, onDragStateChange, edge, offset, stretch]
  );

  const gesture = useMemo(() => Gesture.Race(pan, tap), [pan, tap]);

  // A left trim moves the visible edge; a right trim only changes the width, so
  // the preview transform is the same either way and the commit differs.
  const animated = { transform: [{ translateX: Animated.add(offset, stretch) }] };

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View
        accessibilityRole="button"
        accessibilityState={{ selected }}
        accessibilityLabel={`${label}, ${(lengthMs / 1000).toFixed(1)} seconds`}
        style={[
          styles.clip,
          { left: clip.timelineStartMs * pxPerMs, width, opacity: Math.max(0.35, clip.effects.opacity) },
          kind === 'audio' && styles.audio,
          selected && styles.selected,
          animated
        ]}
      >
        {/*
          The frames, under everything else.

          A clip used to be a coloured rectangle with a filename on it, which on
          a phone made two clips from one source impossible to tell apart —
          finding a shot meant scrubbing the playhead and watching the preview.
          The strip is decorative in the strict sense: it never blocks an edit,
          and a source that will not decode leaves the clip exactly as it was.
        */}
        {thumbnails.length > 0 && (
          <View pointerEvents="none" style={styles.filmstrip}>
            {thumbnails.map((uri, index) => (
              <Image key={`${uri.length}-${index}`} source={{ uri }} style={styles.frame} resizeMode="cover" />
            ))}
          </View>
        )}
        <Text style={[styles.label, thumbnails.length > 0 && styles.labelOverFrames]} numberOfLines={1}>
          {label}
        </Text>
        {/*
          Drawn at the width they actually respond to, not a 5px hint.

          A 5px bar over a 22pt target taught the wrong place to press: people
          aimed at the line, missed the zone, and moved the clip when they meant
          to trim it. Showing the real extent makes the control honest, and a
          clip too narrow for handles shows none — which is also true, since
          there are none.
        */}
        {selected && handle > 0 && (
          <>
            <View pointerEvents="none" style={[styles.handleLeft, { width: handle }]} />
            <View pointerEvents="none" style={[styles.handleRight, { width: handle }]} />
          </>
        )}
      </Animated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  clip: {
    position: 'absolute',
    top: 5,
    bottom: 5,
    borderRadius: 6,
    backgroundColor: theme.accent,
    paddingHorizontal: 8,
    justifyContent: 'center',
    overflow: 'hidden'
  },
  audio: { backgroundColor: theme.mint },
  filmstrip: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, flexDirection: 'row' },
  // Each frame takes an equal share of the clip, so the strip stays even as the
  // timeline zooms and the count changes.
  frame: { flex: 1, height: '100%' },
  // Over frames the label needs its own ground; on the bare block it does not.
  labelOverFrames: {
    color: theme.text,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignSelf: 'flex-start',
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 4,
    overflow: 'hidden'
  },
  selected: { borderWidth: 2, borderColor: theme.text },
  label: { color: theme.bg, fontSize: 11, fontWeight: '700' },
  // Translucent, because at full width an opaque bar would hide the clip rather
  // than mark its edge.
  handleLeft: { position: 'absolute', left: 0, top: 0, bottom: 0, backgroundColor: theme.text, opacity: 0.35 },
  handleRight: { position: 'absolute', right: 0, top: 0, bottom: 0, backgroundColor: theme.text, opacity: 0.35 }
});
