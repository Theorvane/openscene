import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { estimateImageCost } from '@openvideo/shared/mediaGenerationPricing';
import {
  requestBytePlusImage,
  requestImagenImage,
  requestOpenAiImage,
  type GeneratedImageData
} from '@openvideo/shared/imageGeneration';
import type { ImageAspectRatio } from '@openvideo/shared/providerSeams';
import { readKey, type ProviderSlot } from '../lib/credentials';
import { theme } from '../lib/theme';

const RATIOS: readonly ImageAspectRatio[] = ['1:1', '16:9', '9:16', '4:3', '3:4'];

/**
 * Only the models whose adapters exist. Offering one that cannot run turns a tap
 * into a failure the user cannot act on.
 */
const MODELS = [
  { id: 'gpt-image-1', label: 'GPT Image 1', slot: 'openaiApiKey', request: requestOpenAiImage },
  { id: 'imagen-4.0-generate-001', label: 'Imagen 4', slot: 'geminiApiKey', request: requestImagenImage },
  { id: 'seedream-4-0-250828', label: 'Seedream 4.0', slot: 'bytePlusApiKey', request: requestBytePlusImage }
] as const satisfies readonly {
  id: string;
  label: string;
  slot: ProviderSlot;
  request: (input: never) => Promise<GeneratedImageData>;
}[];

type Result =
  | { readonly kind: 'idle' }
  | { readonly kind: 'running' }
  | { readonly kind: 'done'; readonly image: GeneratedImageData }
  | { readonly kind: 'failed'; readonly message: string };

export function ImageScreen({ topInset }: { readonly topInset: number }) {
  const [modelIndex, setModelIndex] = useState(0);
  const [prompt, setPrompt] = useState('');
  const [aspectRatio, setAspectRatio] = useState<ImageAspectRatio>('1:1');
  const [result, setResult] = useState<Result>({ kind: 'idle' });
  const [connected, setConnected] = useState<boolean | null>(null);

  const model = MODELS[modelIndex] ?? MODELS[0];
  const cost = useMemo(() => estimateImageCost({ modelId: model.id, imageCount: 1 }), [model.id]);

  useEffect(() => {
    let cancelled = false;
    void readKey(model.slot).then((key) => {
      if (!cancelled) setConnected(key !== null);
    });
    return () => {
      cancelled = true;
    };
  }, [model.slot]);

  const generate = async (): Promise<void> => {
    const apiKey = await readKey(model.slot);
    if (apiKey === null) {
      setResult({ kind: 'failed', message: `${model.label} is not connected. Add its key in Settings.` });
      return;
    }
    setResult({ kind: 'running' });
    try {
      // The same adapter the desktop app calls, over the same shared module.
      const image = await model.request({ apiKey, modelId: model.id, prompt: prompt.trim(), aspectRatio } as never);
      setResult({ kind: 'done', image });
    } catch (error) {
      setResult({
        kind: 'failed',
        message: error instanceof Error ? error.message : 'Image generation failed.'
      });
    }
  };

  return (
    <ScrollView style={styles.root} contentContainerStyle={[styles.content, { paddingTop: topInset + 16 }]}>
      <Text style={styles.h1}>Generate an image</Text>
      <Text style={styles.sub}>Runs against your own provider account, through the shared adapters.</Text>

      <Text style={styles.label}>Model</Text>
      <View style={styles.row}>
        {MODELS.map((entry, index) => (
          <Pressable
            key={entry.id}
            accessibilityRole="button"
            accessibilityState={{ selected: index === modelIndex }}
            onPress={() => setModelIndex(index)}
            style={[styles.chip, index === modelIndex && styles.chipOn]}
          >
            <Text style={[styles.chipText, index === modelIndex && styles.chipTextOn]}>{entry.label}</Text>
          </Pressable>
        ))}
      </View>
      {connected === false && (
        <Text style={styles.warn}>{model.label} has no key stored — add one in Settings before generating.</Text>
      )}

      <Text style={styles.label}>Aspect ratio</Text>
      <View style={styles.row}>
        {RATIOS.map((ratio) => (
          <Pressable
            key={ratio}
            accessibilityRole="button"
            accessibilityState={{ selected: ratio === aspectRatio }}
            onPress={() => setAspectRatio(ratio)}
            style={[styles.chip, ratio === aspectRatio && styles.chipOn]}
          >
            <Text style={[styles.chipText, ratio === aspectRatio && styles.chipTextOn]}>{ratio}</Text>
          </Pressable>
        ))}
      </View>

      <Text style={styles.label}>Prompt</Text>
      <TextInput
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
        onPress={() => void generate()}
        style={[styles.cta, (result.kind === 'running' || prompt.trim().length === 0) && styles.ctaOff]}
      >
        <Text style={styles.ctaText}>{result.kind === 'running' ? 'Generating…' : 'Generate'}</Text>
      </Pressable>

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
          <Text style={styles.footnote}>{result.image.providerJobId}</Text>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bg },
  content: { padding: 20, paddingBottom: 40, gap: 6 },
  h1: { color: theme.text, fontSize: 26, fontWeight: '700' },
  sub: { color: theme.textWeak, fontSize: 13, lineHeight: 19, marginBottom: 8 },
  label: { color: theme.text, fontSize: 12, fontWeight: '600', marginTop: 20, marginBottom: 8 },
  row: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  chip: { paddingHorizontal: 13, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: theme.line },
  chipOn: { backgroundColor: theme.accent, borderColor: theme.accent },
  chipText: { color: theme.textWeak, fontSize: 13, fontWeight: '600' },
  chipTextOn: { color: theme.bg },
  input: {
    minHeight: 88,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: theme.line,
    backgroundColor: theme.surface,
    color: theme.text,
    fontSize: 14,
    textAlignVertical: 'top'
  },
  cost: { color: theme.textWeak, fontSize: 12, marginTop: 12, fontVariant: ['tabular-nums'] },
  cta: { marginTop: 14, paddingVertical: 14, borderRadius: 10, alignItems: 'center', backgroundColor: theme.accent },
  ctaOff: { opacity: 0.4 },
  ctaText: { color: theme.bg, fontSize: 14, fontWeight: '700' },
  spinner: { marginTop: 20 },
  warn: { color: theme.warn, fontSize: 12, lineHeight: 18, marginTop: 8 },
  error: { color: theme.danger, fontSize: 12, lineHeight: 18, marginTop: 14 },
  resultBox: { marginTop: 20, gap: 8 },
  resultImage: { width: '100%', aspectRatio: 1, borderRadius: 12, backgroundColor: theme.surface },
  footnote: { color: theme.textWeaker, fontSize: 10 }
});
