import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { theme } from '../lib/theme';
import type { Decision, SpendFeature } from '../lib/permissions';
import { MIN_TAP, press } from '../lib/touch';

const LABEL: Record<SpendFeature, string> = {
  'image-generation': 'image generation',
  'video-generation': 'video generation',
  'voice-generation': 'voice generation'
};

/**
 * The desktop's once / always / reject, asked before the charge rather than
 * after it.
 *
 * The headline says what the tap does. Where a price is known and worth showing
 * it is the price; where the screen deliberately does not quote one — video,
 * whose cost the app now handles internally — it is the work instead. Either
 * way it is the concrete thing, because "allow?" on its own tells the user
 * nothing they can weigh.
 */
export function SpendPrompt({
  feature,
  headline,
  visible,
  onDecide,
  onDismiss
}: {
  readonly feature: SpendFeature;
  /** The price, or what will run — whichever the caller is willing to state. */
  readonly headline: string;
  readonly visible: boolean;
  readonly onDecide: (decision: Decision) => void;
  /**
   * Backing out, which is not an answer.
   *
   * This used to be wired to `onDecide('reject')`, and rejecting is remembered:
   * one press of the Android back button turned the feature off for good, with
   * nothing said and only a Settings reset to undo it. A dismissal has to close
   * the question, not answer it.
   */
  readonly onDismiss: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onDismiss}>
      <View style={styles.scrim}>
        <View style={styles.card}>
          <Text style={styles.title}>Charge your {LABEL[feature].split(' ')[0]} provider?</Text>
          <Text style={styles.headline}>{headline}</Text>
          <Text style={styles.body}>
            This runs against your own account. “Always” applies to {LABEL[feature]} only, and can be cleared in
            Settings.
          </Text>
          <Pressable accessibilityRole="button" style={press(styles.primary)} onPress={() => onDecide('once')}>
            <Text style={styles.primaryText}>Allow once</Text>
          </Pressable>
          <Pressable accessibilityRole="button" style={press(styles.secondary)} onPress={() => onDecide('always')}>
            <Text style={styles.secondaryText}>Always allow {LABEL[feature]}</Text>
          </Pressable>
          <Pressable accessibilityRole="button" style={press(styles.secondary)} onPress={() => onDecide('reject')}>
            <Text style={styles.rejectText}>Not now</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: '#000000cc', justifyContent: 'center', padding: 26 },
  card: { backgroundColor: theme.surface, borderRadius: 16, padding: 20, gap: 10, borderWidth: 1, borderColor: theme.line },
  title: { color: theme.text, fontSize: 17, fontWeight: '700' },
  headline: { color: theme.mint, fontSize: 22, fontWeight: '700', fontVariant: ['tabular-nums'] },
  body: { color: theme.textWeak, fontSize: 13, lineHeight: 19, marginBottom: 4 },
  primary: { minHeight: 50, justifyContent: 'center', borderRadius: 10, alignItems: 'center', backgroundColor: theme.accent },
  primaryText: { color: theme.bg, fontSize: 15, fontWeight: '700' },
  secondary: { minHeight: MIN_TAP, justifyContent: 'center', borderRadius: 10, alignItems: 'center', borderWidth: 1, borderColor: theme.line },
  secondaryText: { color: theme.text, fontSize: 14, fontWeight: '600' },
  rejectText: { color: theme.textWeak, fontSize: 14, fontWeight: '600' }
});
