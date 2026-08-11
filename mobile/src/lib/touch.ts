import { StyleSheet } from 'react-native';
import type { Insets, PressableStateCallbackType, StyleProp, ViewStyle } from 'react-native';

/**
 * How big a target has to be, and what a tap looks like.
 *
 * 44pt is the iOS minimum and Material asks 48dp, so 44 drawn plus slop clears
 * both. Drawing every control at 44 is not the answer — the transport row and
 * the track rail would eat the timeline — so the rule is about the *hit area*:
 * `slopFor` grows it around a control that is deliberately drawn smaller,
 * without changing what is on screen.
 *
 * The press style exists because every Pressable in the app was static. A tap
 * said nothing until its effect landed, and the effects here run against a
 * remote provider — seconds of silence read as a dropped tap, so the user taps
 * again.
 */

export const MIN_TAP = 44;

/** Hit area padding that brings a control drawn at `width` × `height` up to 44pt. */
export function slopFor(width: number, height: number = width): Insets | undefined {
  const horizontal = Math.max(0, Math.round((MIN_TAP - width) / 2));
  const vertical = Math.max(0, Math.round((MIN_TAP - height) / 2));
  if (horizontal === 0 && vertical === 0) return undefined;
  return { left: horizontal, right: horizontal, top: vertical, bottom: vertical };
}

/** `style` for a Pressable, dimmed while the finger is down. */
export function press(style: StyleProp<ViewStyle>): (state: PressableStateCallbackType) => StyleProp<ViewStyle> {
  return ({ pressed }) => [style, pressed && styles.pressed];
}

const styles = StyleSheet.create({
  pressed: { opacity: 0.55 }
});
