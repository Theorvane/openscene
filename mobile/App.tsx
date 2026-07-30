import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';

// The point of this screen. These are the desktop app's own modules, imported
// across the repository rather than copied: if they run here, the domain core
// crosses to React Native and the framework decision holds. If they do not,
// this is where it fails and the decision was wrong.
import { estimateVideoPlanCost, PRICING_AS_OF } from '@openvideo/shared/mediaGenerationPricing';
import { planVideoStoryboard, supportedShotSeconds } from '@openvideo/shared/videoStoryboardPlan';

const LENGTHS = [8, 20, 30, 45] as const;
const MODEL = { id: 'sora-2', providerId: 'openai', label: 'Sora 2' } as const;

export default function App() {
  const [totalSeconds, setTotalSeconds] = useState<number>(30);

  const plan = useMemo(
    () => planVideoStoryboard({ totalSeconds, providerId: MODEL.providerId }),
    [totalSeconds]
  );

  const cost = useMemo(
    () =>
      estimateVideoPlanCost(
        plan.shots.map((shot) => ({ modelId: MODEL.id, durationSeconds: shot.durationSeconds }))
      ),
    [plan]
  );

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.kicker}>SHARED CORE ON REACT NATIVE</Text>
        <Text style={styles.title}>Shot planning and pricing</Text>
        <Text style={styles.body}>
          Both computed by the desktop app&apos;s own modules, running unmodified under Metro and Hermes.
        </Text>

        <Text style={styles.label}>Target length</Text>
        <View style={styles.row}>
          {LENGTHS.map((seconds) => {
            const selected = seconds === totalSeconds;
            return (
              <Pressable
                key={seconds}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                onPress={() => setTotalSeconds(seconds)}
                style={[styles.chip, selected && styles.chipSelected]}
              >
                <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{seconds}s</Text>
              </Pressable>
            );
          })}
        </View>

        <Text style={styles.label}>
          Shots · {MODEL.label} accepts {supportedShotSeconds(MODEL.providerId).join('/')}s
        </Text>
        {plan.shots.map((shot) => (
          <View key={shot.index} style={styles.shot}>
            <Text style={styles.shotIndex}>{String(shot.index).padStart(2, '0')}</Text>
            <Text style={styles.shotBody}>
              starts {shot.startSeconds}s · {shot.durationSeconds}s
            </Text>
          </View>
        ))}

        {/* The planner reports this when the request is not reachable from the
            model's shot lengths, rather than quietly delivering a different
            length. Surfacing it here proves that behaviour survived the port. */}
        {plan.roundedFrom !== undefined && (
          <Text style={styles.note}>
            {plan.roundedFrom}s is not reachable from these shot lengths — this plan runs {plan.totalSeconds}s.
          </Text>
        )}

        <Text style={styles.label}>Estimated cost</Text>
        {cost.fullyPriced && cost.totalUsd !== undefined ? (
          <Text style={styles.total}>~${cost.totalUsd.toFixed(2)}</Text>
        ) : (
          <Text style={styles.note}>
            Not fully priced — the total is withheld rather than shown as a partial sum.
          </Text>
        )}
        {/* Read the fields rather than truncating the formatted sentence: the
            first attempt split it on '.' and cut $1.20 down to $1, so the per-shot
            lines no longer added up to the total. */}
        {cost.shots.map((estimate, index) => (
          <Text key={index} style={styles.estimate}>
            {String(index + 1).padStart(2, '0')} ·{' '}
            {estimate.priced && estimate.amountUsd !== undefined
              ? `$${estimate.amountUsd.toFixed(2)}  ${estimate.basis}`
              : 'unpriced'}
          </Text>
        ))}
        <Text style={styles.footer}>List price recorded {PRICING_AS_OF}. An estimate, not a quote.</Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#101014' },
  content: { padding: 24, paddingTop: 72, gap: 8 },
  kicker: { color: '#78f7bc', fontSize: 11, letterSpacing: 1.4, fontWeight: '600' },
  title: { color: '#f5f5f7', fontSize: 26, fontWeight: '700', marginTop: 4 },
  body: { color: '#a0a0aa', fontSize: 14, lineHeight: 20, marginBottom: 12 },
  label: { color: '#f5f5f7', fontSize: 12, fontWeight: '600', marginTop: 20, marginBottom: 8 },
  row: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: '#2a2a32' },
  chipSelected: { backgroundColor: '#a690ff', borderColor: '#a690ff' },
  chipText: { color: '#a0a0aa', fontSize: 13, fontWeight: '600' },
  chipTextSelected: { color: '#101014' },
  shot: { flexDirection: 'row', gap: 12, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: '#1c1c22' },
  shotIndex: { color: '#78f7bc', fontSize: 13, fontVariant: ['tabular-nums'], fontWeight: '600' },
  shotBody: { color: '#d0d0d6', fontSize: 13, fontVariant: ['tabular-nums'] },
  note: { color: '#f0c674', fontSize: 12, lineHeight: 18, marginTop: 4 },
  total: { color: '#f5f5f7', fontSize: 30, fontWeight: '700', fontVariant: ['tabular-nums'] },
  estimate: { color: '#a0a0aa', fontSize: 12, fontVariant: ['tabular-nums'] },
  footer: { color: '#6a6a74', fontSize: 11, lineHeight: 16, marginTop: 20 }
});
