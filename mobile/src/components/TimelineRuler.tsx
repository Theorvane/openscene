import { StyleSheet, Text, View } from 'react-native';

import { theme } from '../lib/theme';

/**
 * A time ruler, and the step arithmetic behind it.
 *
 * The timeline had no scale at all: at one zoom a clip was a wide bar and at
 * another it was a stub, with nothing on screen to say which. A ruler is also
 * the only honest target for scrubbing — tapping an empty lane worked, but a
 * timeline whose lanes are full of clips has no empty lane left to tap.
 */

/**
 * Seconds between labels, chosen so they land roughly every 90px.
 *
 * Fixed steps rather than a computed one: 7.3-second gridlines are arithmetic
 * nobody reads, and the familiar 1/5/15/60 progression is what makes a glance
 * at the ruler tell you the scale.
 */
const STEPS = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600] as const;

export function rulerStepSeconds(pxPerSecond: number): number {
  const target = 90 / Math.max(pxPerSecond, 0.001);
  return STEPS.find((step) => step >= target) ?? STEPS[STEPS.length - 1];
}

function label(seconds: number): string {
  if (seconds < 60) return `${Number.isInteger(seconds) ? seconds : seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds - minutes * 60);
  return rest === 0 ? `${minutes}m` : `${minutes}:${String(rest).padStart(2, '0')}`;
}

export function TimelineRuler({
  durationMs,
  pxPerMs,
  width
}: {
  readonly durationMs: number;
  readonly pxPerMs: number;
  readonly width: number;
}) {
  const step = rulerStepSeconds(pxPerMs * 1000);
  // Ticks run past the end of the media so the ruler still reads as a scale in
  // the empty space a user drags a clip into.
  const spanSeconds = Math.max(durationMs / 1000, width / (pxPerMs * 1000));
  const count = Math.floor(spanSeconds / step) + 1;

  return (
    // The ticks are decoration and must not be touch targets. The scrubbing
    // Pressable this sits inside reads `locationX`, which on Android is measured
    // from the view that actually received the touch — so a tap landing on a
    // tick's label was reported relative to that label rather than to the lane,
    // and scrubbed to a fraction of a second instead of to the moment under the
    // finger. Tapping between labels always worked, which is what made it look
    // intermittent rather than broken. Skipping the children leaves this root as
    // the target, and it shares its origin with the lane.
    <View style={[styles.root, { width }]}>
      {Array.from({ length: count }, (_, index) => {
        const seconds = index * step;
        return (
          <View key={seconds} pointerEvents="none" style={[styles.tick, { left: seconds * 1000 * pxPerMs }]}>
            <View style={styles.mark} />
            <Text style={styles.label}>{label(seconds)}</Text>
          </View>
        );
      })}
      {/* A half-step tick between labels: enough to judge a position without
          crowding the numbers. */}
      {Array.from({ length: count }, (_, index) => (
        <View
          key={`half-${index}`}
          pointerEvents="none"
          style={[styles.half, { left: (index + 0.5) * step * 1000 * pxPerMs }]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { height: 28, borderBottomWidth: 1, borderBottomColor: theme.line, position: 'relative' },
  tick: { position: 'absolute', top: 0, bottom: 0, alignItems: 'flex-start' },
  mark: { width: 1, height: 9, backgroundColor: theme.line },
  half: { position: 'absolute', top: 0, width: 1, height: 5, backgroundColor: theme.line, opacity: 0.6 },
  label: { color: theme.textWeak, fontSize: 11, marginLeft: 3, fontVariant: ['tabular-nums'] }
});
