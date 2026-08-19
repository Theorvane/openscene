import { useMemo, useRef } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector, type GestureType } from 'react-native-gesture-handler';

import type { PersistedTimelineClip } from '@openvideo/shared/timelineTypes';
import { handleWidthFor, MIN_CLIP_WIDTH } from '../lib/timelineHandles';
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
  const lengthMs = clip.sourceEndMs - clip.sourceStartMs;
  const width = Math.max(MIN_CLIP_WIDTH, lengthMs * pxPerMs);
  const handle = handleWidthFor(width);

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
        // Only a selected clip takes the drag. The timeline scrolls sideways and
        // so do these drags, so tap to select is what says which one is meant.
        .enabled(selected)
        .blocksExternalGesture(scrollGesture)
        // A tap must stay a tap: selection is the common action, so a gesture
        // only becomes a drag once it has clearly travelled.
        .activeOffsetX([-6, 6])
        .runOnJS(true)
        .onBegin((event) => {
          edge.current = event.x < handle ? 'left' : event.x > width - handle ? 'right' : 'move';
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
    [selected, scrollGesture, handle, width, pxPerMs, clip.timelineStartMs, lengthMs, onMove, onTrim, onDragStateChange, edge, offset, stretch]
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
        <Text style={styles.label} numberOfLines={1}>
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
  selected: { borderWidth: 2, borderColor: theme.text },
  label: { color: theme.bg, fontSize: 11, fontWeight: '700' },
  // Translucent, because at full width an opaque bar would hide the clip rather
  // than mark its edge.
  handleLeft: { position: 'absolute', left: 0, top: 0, bottom: 0, backgroundColor: theme.text, opacity: 0.35 },
  handleRight: { position: 'absolute', right: 0, top: 0, bottom: 0, backgroundColor: theme.text, opacity: 0.35 }
});
