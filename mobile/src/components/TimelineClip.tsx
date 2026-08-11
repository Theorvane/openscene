import { useMemo, useRef } from 'react';
import { Animated, PanResponder, StyleSheet, Text, View } from 'react-native';

import type { PersistedTimelineClip } from '@openvideo/shared/timelineTypes';
import { theme } from '../lib/theme';

/**
 * A clip you drag, rather than nudge.
 *
 * The handles are 22pt wide — under a fingertip, a 4px edge like the desktop's
 * is unhittable, and a miss trims when the user meant to move. Everything is
 * previewed with a transform and committed once on release: the shared rules can
 * reject an intermediate position mid-drag, and re-rendering the document at
 * finger rate would fight the gesture.
 *
 * Only a *selected* clip takes the gesture. The timeline scrolls horizontally and
 * so do these drags, so one of them has to yield: if clips always claimed the
 * touch, a timeline wider than the screen could not be scrolled by dragging over
 * the very clips that fill it. Tap to select, then drag — and the capture phase
 * is used, because otherwise the enclosing ScrollView claims the pan first and
 * the clip never sees it.
 */

const HANDLE_WIDTH = 22;
const MIN_WIDTH = 26;

export function TimelineClip({
  clip,
  label,
  kind,
  selected,
  pxPerMs,
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
  readonly onSelect: () => void;
  readonly onMove: (timelineStartMs: number) => void;
  readonly onTrim: (edge: 'left' | 'right', timelineMs: number) => void;
  /** Lets the screen freeze the scroll view for the duration of a drag. */
  readonly onDragStateChange: (dragging: boolean) => void;
}) {
  const lengthMs = clip.sourceEndMs - clip.sourceStartMs;
  const width = Math.max(MIN_WIDTH, lengthMs * pxPerMs);

  // Transforms during the gesture; the document is the source of truth again the
  // moment the finger lifts.
  const dragX = useRef(new Animated.Value(0)).current;
  const trimLeft = useRef(new Animated.Value(0)).current;
  const trimRight = useRef(new Animated.Value(0)).current;
  const gesture = useRef<'move' | 'left' | 'right'>('move');

  // Recreated when selection changes, because the responder callbacks close over
  // it and a stale closure would keep refusing the gesture after a tap.
  const responder = useMemo(
    () =>
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onStartShouldSetPanResponderCapture: () => selected,
      // A tap must stay a tap: selection is the common action, so a gesture only
      // becomes a drag once it has clearly travelled.
      onMoveShouldSetPanResponder: (_event, state) => selected && Math.abs(state.dx) > 4,
      onMoveShouldSetPanResponderCapture: (_event, state) => selected && Math.abs(state.dx) > 4,
      onPanResponderGrant: (event) => {
        onSelect();
        onDragStateChange(true);
        const x = event.nativeEvent.locationX;
        const currentWidth = Math.max(MIN_WIDTH, (clip.sourceEndMs - clip.sourceStartMs) * pxPerMs);
        gesture.current = x < HANDLE_WIDTH ? 'left' : x > currentWidth - HANDLE_WIDTH ? 'right' : 'move';
      },
      onPanResponderMove: (_event, state) => {
        if (gesture.current === 'move') dragX.setValue(state.dx);
        else if (gesture.current === 'left') trimLeft.setValue(state.dx);
        else trimRight.setValue(state.dx);
      },
      onPanResponderRelease: (_event, state) => {
        onDragStateChange(false);
        const deltaMs = state.dx / pxPerMs;
        dragX.setValue(0);
        trimLeft.setValue(0);
        trimRight.setValue(0);
        if (Math.abs(state.dx) < 4) return;
        if (gesture.current === 'move') onMove(clip.timelineStartMs + deltaMs);
        else if (gesture.current === 'left') onTrim('left', clip.timelineStartMs + deltaMs);
        else onTrim('right', clip.timelineStartMs + lengthMs + deltaMs);
      },
      onPanResponderTerminate: () => {
        onDragStateChange(false);
        dragX.setValue(0);
        trimLeft.setValue(0);
        trimRight.setValue(0);
      }
    }),
    [selected, pxPerMs, clip, lengthMs, onSelect, onMove, onTrim, onDragStateChange, dragX, trimLeft, trimRight]
  );

  return (
    <Animated.View
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={`${label}, ${(lengthMs / 1000).toFixed(1)} seconds`}
      {...responder.panHandlers}
      style={[
        styles.clip,
        {
          left: clip.timelineStartMs * pxPerMs,
          width,
          transform: [{ translateX: Animated.add(dragX, trimLeft) }],
          opacity: Math.max(0.35, clip.effects.opacity)
        },
        kind === 'audio' && styles.audio,
        selected && styles.selected
      ]}
    >
      <Text style={styles.label} numberOfLines={1}>
        {label}
      </Text>
      {selected && (
        <>
          <View style={styles.handleLeft} pointerEvents="none" />
          <View style={styles.handleRight} pointerEvents="none" />
        </>
      )}
    </Animated.View>
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
  handleLeft: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 5, backgroundColor: theme.text },
  handleRight: { position: 'absolute', right: 0, top: 0, bottom: 0, width: 5, backgroundColor: theme.text }
});
