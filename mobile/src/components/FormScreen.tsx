import type { ReactElement, ReactNode } from 'react';
import { KeyboardAvoidingView, StyleSheet, View } from 'react-native';
import type { RefreshControlProps, StyleProp, ViewStyle } from 'react-native';

import { KeyboardAwareScroll } from './KeyboardAwareScroll';
import { theme } from '../lib/theme';

/**
 * A scrolling screen that keeps the keyboard off the control being used.
 *
 * Every form screen here is the same shape — a scroll view holding a field and,
 * below it, the button that acts on what was typed — and every one of them had
 * the same two faults. The keyboard covered the button, and tapping the button
 * while the field was focused only dismissed the keyboard, because a ScrollView
 * blocks the touch by default to do exactly that. The second is the worse one:
 * the tap looks like it did nothing.
 *
 * `padding` on both platforms, not iOS alone. Leaving Android to `adjustResize`
 * is what the manifest asks for and what Android used to do, but edge-to-edge is
 * mandatory from this SDK — the plugin refuses to turn it off — and an
 * edge-to-edge window is not resized for the keyboard. The keyboard simply draws
 * over the app, so the screen has to move its own content on both platforms.
 *
 * Avoiding is not revealing, which is why the scroll view is the keyboard-aware
 * one: shrinking the scrolling area does nothing for a field the user has to
 * scroll down to reach, and Settings is long enough that most of them are.
 *
 * `keyboardOffset` is not optional dressing. KeyboardAvoidingView measures
 * itself with `onLayout`, which reports a position relative to its parent, and
 * then compares that to a keyboard position in screen coordinates. When the view
 * does not start at the top of the screen the two disagree by exactly the height
 * of whatever sits above it, and the content is lifted that much too little —
 * far enough to look like the fix works and still leave the button covered.
 */
export function FormScreen({
  topInset,
  keyboardOffset = 0,
  contentStyle,
  refreshControl,
  children
}: {
  readonly topInset: number;
  /** Height of the chrome above this screen, in screen coordinates. */
  readonly keyboardOffset?: number;
  /** Applied to the column the children sit in — most callers only change `gap`. */
  readonly contentStyle?: StyleProp<ViewStyle>;
  readonly refreshControl?: ReactElement<RefreshControlProps>;
  readonly children: ReactNode;
}) {
  return (
    <KeyboardAvoidingView style={styles.root} behavior="padding" keyboardVerticalOffset={keyboardOffset}>
      <KeyboardAwareScroll
        style={styles.root}
        contentContainerStyle={[styles.content, { paddingTop: topInset + 16 }]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        {...(refreshControl === undefined ? {} : { refreshControl })}
      >
        <View style={[styles.inner, contentStyle]}>{children}</View>
      </KeyboardAwareScroll>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bg },
  content: { padding: 20, paddingBottom: 48 },
  // The gap lives here rather than on the content container so a caller can
  // override the padding without losing the rhythm between rows.
  inner: { gap: 6 }
});
