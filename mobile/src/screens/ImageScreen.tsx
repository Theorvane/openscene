import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { estimateImageCost } from '@openvideo/shared/mediaGenerationPricing';
import {
  requestBytePlusImage,
  requestImagenImage,
  requestOpenAiImage,
  type GeneratedImageData
} from '@openvideo/shared/imageGeneration';
import type { ImageAspectRatio } from '@openvideo/shared/providerSeams';
import { readKey, type ProviderSlot } from '../lib/credentials';
import { readProviderConnections } from '../lib/mediaProviders';
import { saveGeneratedImage } from '../lib/projectStore';
import { useSpendPermissions, type Decision } from '../lib/permissions';
import { chargeReservation, releaseReservation, reserveAgainstCap } from '../lib/spendLedger';
import { ModelSelect } from '../components/ModelSelect';
import { SpendPrompt } from '../components/SpendPrompt';
import { getDomainModels } from '@openvideo/shared/aiDomainModels';
import { FormScreen } from '../components/FormScreen';
import { useRevealOnFocus } from '../components/KeyboardAwareScroll';
import { theme } from '../lib/theme';
import { MIN_TAP, press } from '../lib/touch';

const RATIOS: readonly ImageAspectRatio[] = ['1:1', '16:9', '9:16', '4:3', '3:4'];

/** Which adapter and credential slot each provider id resolves to. */
const PROVIDER_BINDINGS: Readonly<Record<string, { slot: ProviderSlot; request: (input: never) => Promise<GeneratedImageData> }>> = {
  openai: { slot: 'openaiApiKey', request: requestOpenAiImage as never },
  google_gemini: { slot: 'geminiApiKey', request: requestImagenImage as never },
  byteplus: { slot: 'bytePlusApiKey', request: requestBytePlusImage as never }
};

type Result =
  | { readonly kind: 'idle' }
  | { readonly kind: 'running' }
  | { readonly kind: 'done'; readonly image: GeneratedImageData; readonly saved: boolean }
  | { readonly kind: 'failed'; readonly message: string };

export function ImageScreen({
  topInset,
  keyboardOffset,
  projectId,
  connectionsVersion
}: {
  readonly topInset: number;
  /** Height of the chrome above this screen; see FormScreen. */
  readonly keyboardOffset: number;
  readonly projectId: string | null;
  /** Changes when Settings closes, so stored keys are picked up. */
  readonly connectionsVersion: number;
}) {
  const catalog = getDomainModels('image-generation');
  const [modelId, setModelId] = useState<string>(() => catalog.find((entry) => entry.available)?.id ?? '');
  const [connected, setConnectedSlots] = useState<Readonly<Record<string, boolean>>>({});
  const [pending, setPending] = useState<null | (() => void)>(null);
  const permissions = useSpendPermissions();
  const [prompt, setPrompt] = useState('');
  const [aspectRatio, setAspectRatio] = useState<ImageAspectRatio>('1:1');
  const [result, setResult] = useState<Result>({ kind: 'idle' });
  const reveal = useRevealOnFocus();
  const promptInput = useRef<TextInput>(null);

  const model = catalog.find((entry) => entry.id === modelId) ?? catalog[0];
  const binding = model === undefined ? undefined : PROVIDER_BINDINGS[model.providerId];
  const cost = useMemo(() => estimateImageCost({ modelId: modelId, imageCount: 1 }), [modelId]);
  const costLine = cost.priced && cost.amountUsd !== undefined ? `~$${cost.amountUsd.toFixed(2)}` : 'Cost unknown';

  // Connection is reported per provider, so the picker can say which models can
  // actually run rather than only which exist.
  const refreshConnections = useCallback((): void => {
    void readProviderConnections().then(setConnectedSlots);
  }, []);

  useEffect(refreshConnections, [refreshConnections, connectionsVersion]);

  const doGenerate = async (): Promise<void> => {
    if (model === undefined || binding === undefined) return;
    /*
      The ceiling, before the key.

      A limit that is only checked after a provider has been called is not a
      limit; the charge is already made. "Always" on this feature means every
      future image, and this is what bounds it.
    */
    const reservation = reserveAgainstCap(cost, new Date().toISOString());
    if (!reservation.ok) {
      setResult({ kind: 'failed', message: reservation.reason });
      return;
    }
    const apiKey = await readKey(binding.slot);
    if (apiKey === null) {
      // Nothing was asked of a provider, so the room goes back.
      releaseReservation(reservation.id);
      setResult({ kind: 'failed', message: `${model.providerLabel} is not connected. Add its key in Settings.` });
      return;
    }
    setResult({ kind: 'running' });
    try {
      // The same adapter the desktop app calls, over the same shared module.
      // Kept as the request goes out, which is where the money is committed —
      // not when the screen decided to ask for one.
      chargeReservation(reservation.id);
      const image = await binding.request({ apiKey, modelId: model.id, prompt: prompt.trim(), aspectRatio } as never);
      // Kept before it is shown. A still that only exists on screen is lost the
      // moment the tab changes, and it was paid for.
      const saved = saveGeneratedImage(projectId ?? '', {
        base64: image.base64,
        mimeType: image.mimeType,
        prompt: prompt.trim(),
        modelId: model.id
      });
      setResult({ kind: 'done', image, saved: saved !== null });
    } catch (error) {
      // Only takes back a reservation that is still pending, so a provider
      // that failed after being called still counts as a charge.
      releaseReservation(reservation.id);
      setResult({
        kind: 'failed',
        message: error instanceof Error ? error.message : 'Image generation failed.'
      });
    }
  };

  /** Asks unless the user already said always; rejecting is remembered too. */
  const generate = (): void => {
    const standing = permissions.standingFor('image-generation');
    if (standing === 'reject') {
      setResult({ kind: 'failed', message: 'Image generation is set to never charge. Change it in Settings.' });
      return;
    }
    if (standing === 'always') {
      void doGenerate();
      return;
    }
    setPending(() => () => void doGenerate());
  };

  const decide = (decision: Decision): void => {
    const run = pending;
    setPending(null);
    permissions.remember('image-generation', decision);
    if (decision !== 'reject') run?.();
  };

  return (
    <FormScreen topInset={topInset} keyboardOffset={keyboardOffset}>
      <Text style={styles.h1}>Generate an image</Text>
      <Text style={styles.sub}>Runs against your own provider account, through the shared adapters.</Text>

      <Text style={styles.label}>Model</Text>
      <ModelSelect
        domain="image-generation"
        selectedId={modelId}
        connected={connected}
        onSelect={(next) => setModelId(next.id)}
        onConnectionChange={refreshConnections}
      />

      <Text style={styles.label}>Aspect ratio</Text>
      <View style={styles.row}>
        {RATIOS.map((ratio) => (
          <Pressable
            key={ratio}
            accessibilityRole="button"
            accessibilityState={{ selected: ratio === aspectRatio }}
            onPress={() => setAspectRatio(ratio)}
            style={press([styles.chip, ratio === aspectRatio && styles.chipOn])}
          >
            <Text style={[styles.chipText, ratio === aspectRatio && styles.chipTextOn]}>{ratio}</Text>
          </Pressable>
        ))}
      </View>

      <Text style={styles.label}>Prompt</Text>
      <TextInput
        ref={promptInput}
        onFocus={() => reveal(promptInput.current)}
        style={styles.input}
        value={prompt}
        onChangeText={setPrompt}
        placeholder="Describe the image…"
        placeholderTextColor={theme.textWeaker}
        multiline
        accessibilityLabel="Image prompt"
      />

      <Text style={styles.cost}>
        {cost.priced && cost.amountUsd !== undefined
          ? `~$${cost.amountUsd.toFixed(2)} · ${cost.basis}`
          : `Cost unknown for ${model.label} — you are accepting an unknown charge.`}
      </Text>

      <Pressable
        accessibilityRole="button"
        disabled={result.kind === 'running' || prompt.trim().length === 0}
        onPress={generate}
        style={press([styles.cta, (result.kind === 'running' || prompt.trim().length === 0) && styles.ctaOff])}
      >
        <Text style={styles.ctaText}>{result.kind === 'running' ? 'Generating…' : 'Generate'}</Text>
      </Pressable>

      <SpendPrompt
        feature="image-generation"
        headline={costLine}
        visible={pending !== null}
        onDecide={decide}
        onDismiss={() => setPending(null)}
      />

      {result.kind === 'running' && <ActivityIndicator color={theme.accent} style={styles.spinner} />}
      {result.kind === 'failed' && <Text style={styles.error}>{result.message}</Text>}
      {result.kind === 'done' && (
        <View style={styles.resultBox}>
          {/* Inline base64 — the same shape the desktop hands to image-to-video,
              so nothing here needs a file path. */}
          <Image
            style={styles.resultImage}
            source={{ uri: `data:${result.image.mimeType};base64,${result.image.base64}` }}
            accessibilityLabel="Generated image"
          />
          <Text style={styles.footnote}>
            {result.saved ? 'Saved to this project — see the Library tab.' : result.image.providerJobId}
          </Text>
        </View>
      )}
    </FormScreen>
  );
}

const styles = StyleSheet.create({
  h1: { color: theme.text, fontSize: 26, fontWeight: '700' },
  sub: { color: theme.textWeak, fontSize: 13, lineHeight: 19, marginBottom: 8 },
  label: { color: theme.text, fontSize: 13, fontWeight: '600', marginTop: 20, marginBottom: 8 },
  row: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  chip: { minHeight: MIN_TAP, justifyContent: 'center', paddingHorizontal: 16, borderRadius: 10, borderWidth: 1, borderColor: theme.line },
  chipOn: { backgroundColor: theme.accent, borderColor: theme.accent },
  chipText: { color: theme.textWeak, fontSize: 14, fontWeight: '600' },
  chipTextOn: { color: theme.bg },
  input: {
    minHeight: 96,
    padding: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: theme.line,
    backgroundColor: theme.surface,
    color: theme.text,
    fontSize: 15,
    lineHeight: 21,
    textAlignVertical: 'top'
  },
  cost: { color: theme.textWeak, fontSize: 13, marginTop: 12, fontVariant: ['tabular-nums'] },
  cta: { marginTop: 14, minHeight: 52, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.accent },
  ctaOff: { opacity: 0.4 },
  ctaText: { color: theme.bg, fontSize: 15, fontWeight: '700' },
  spinner: { marginTop: 20 },
  error: { color: theme.danger, fontSize: 13, lineHeight: 19, marginTop: 14 },
  resultBox: { marginTop: 20, gap: 8 },
  resultImage: { width: '100%', aspectRatio: 1, borderRadius: 12, backgroundColor: theme.surface },
  footnote: { color: theme.textWeaker, fontSize: 11 }
});
