import type { ReactElement, ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import type { RefreshControlProps, StyleProp, ViewStyle } from 'react-native';

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
 * `padding` on iOS and nothing on Android is deliberate. Android resizes the
 * window for the keyboard already (Expo's default `adjustResize`), and asking
 * for padding on top of that lifts the content twice.
 */
export function FormScreen({
  topInset,
  contentStyle,
  refreshControl,
  children
}: {
  readonly topInset: number;
  /** Applied to the column the children sit in — most callers only change `gap`. */
  readonly contentStyle?: StyleProp<ViewStyle>;
  readonly refreshControl?: ReactElement<RefreshControlProps>;
  readonly children: ReactNode;
}) {
  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        style={styles.root}
        contentContainerStyle={[styles.content, { paddingTop: topInset + 16 }]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        {...(refreshControl === undefined ? {} : { refreshControl })}
      >
        <View style={[styles.inner, contentStyle]}>{children}</View>
      </ScrollView>
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
