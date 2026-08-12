import { useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { addCustomProvider, customCredentialKey } from '../lib/customProviders';
import { writeSlot } from '../lib/credentials';
import { useRevealOnFocus } from './KeyboardAwareScroll';
import { theme } from '../lib/theme';
import { MIN_TAP, press } from '../lib/touch';

/**
 * Add any OpenAI-compatible endpoint.
 *
 * The built-in catalog is long and still cannot cover a self-hosted server, a
 * gateway, or a regional deployment. Anything speaking that wire format needs no
 * new code — only a base URL, a key, and the model names, which the user has to
 * supply because the endpoint is not required to list them.
 */
export function AddCustomProvider({ onAdded }: { readonly onAdded: () => void }) {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [models, setModels] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = async (): Promise<void> => {
    const result = addCustomProvider({ label, baseUrl, models });
    if (!result.ok) {
      setError(result.message);
      return;
    }
    // The key goes to the keystore under the provider's own slot, the same place
    // and the same way as every built-in one.
    if (apiKey.trim().length > 0) await writeSlot(customCredentialKey(result.provider.id), apiKey);
    setLabel('');
    setBaseUrl('');
    setModels('');
    setApiKey('');
    setError(null);
    setOpen(false);
    onAdded();
  };

  if (!open) {
    return (
      <Pressable accessibilityRole="button" onPress={() => setOpen(true)} style={press(styles.opener)}>
        <Text style={styles.openerText}>＋ Add a custom provider</Text>
      </Pressable>
    );
  }

  return (
    <View style={styles.card}>
      <Text style={styles.title}>Custom provider</Text>
      <Text style={styles.blurb}>
        Any endpoint that speaks the OpenAI chat-completions API — Alibaba, a gateway, or your own server. Chat only:
        image and video providers each need their own adapter, so a URL alone cannot drive them.
      </Text>

      <Field label="Name" value={label} onChange={setLabel} placeholder="Alibaba Qwen" />
      <Field
        label="Base URL"
        value={baseUrl}
        onChange={setBaseUrl}
        placeholder="https://dashscope-intl.aliyuncs.com/compatible-mode/v1"
        autoCapitalize="none"
      />
      <Field
        label="Models"
        value={models}
        onChange={setModels}
        placeholder="qwen-max, qwen-plus"
        autoCapitalize="none"
        multiline
      />
      <Field label="API key" value={apiKey} onChange={setApiKey} placeholder="sk-…" secure autoCapitalize="none" />

      {error !== null && <Text style={styles.error}>{error}</Text>}

      <View style={styles.actions}>
        <Pressable accessibilityRole="button" onPress={() => void submit()} style={press(styles.save)}>
          <Text style={styles.saveText}>Add</Text>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={() => setOpen(false)} style={press(styles.cancel)}>
          <Text style={styles.cancelText}>Cancel</Text>
        </Pressable>
      </View>
      <Text style={styles.footnote}>
        The base URL is the part before /chat/completions. The key is held in the device keystore, like every other
        provider.
      </Text>
    </View>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  secure,
  multiline,
  autoCapitalize
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  placeholder: string;
  secure?: boolean;
  multiline?: boolean;
  autoCapitalize?: 'none' | 'sentences';
}) {
  const reveal = useRevealOnFocus();
  const input = useRef<TextInput>(null);
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        ref={input}
        onFocus={() => reveal(input.current)}
        style={[styles.input, multiline === true && styles.inputMulti]}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={theme.textWeaker}
        secureTextEntry={secure === true}
        multiline={multiline === true}
        autoCorrect={false}
        autoCapitalize={autoCapitalize ?? 'sentences'}
        accessibilityLabel={label}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  opener: { minHeight: MIN_TAP, justifyContent: 'center', borderRadius: 9, borderWidth: 1, borderStyle: 'dashed', borderColor: theme.line, alignItems: 'center' },
  openerText: { color: theme.textWeak, fontSize: 14, fontWeight: '600' },
  card: { padding: 14, borderRadius: 12, borderWidth: 1, borderColor: theme.accent, backgroundColor: theme.surface, gap: 8 },
  title: { color: theme.text, fontSize: 15, fontWeight: '700' },
  blurb: { color: theme.textWeak, fontSize: 13, lineHeight: 18 },
  field: { gap: 4 },
  fieldLabel: { color: theme.textWeaker, fontSize: 12, fontWeight: '700', letterSpacing: 0.4 },
  input: {
    minHeight: MIN_TAP,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: theme.line,
    backgroundColor: theme.bg,
    color: theme.text,
    fontSize: 15
  },
  inputMulti: { minHeight: 64, textAlignVertical: 'top' },
  error: { color: theme.danger, fontSize: 13, lineHeight: 18 },
  actions: { flexDirection: 'row', gap: 8, marginTop: 2 },
  save: { minHeight: MIN_TAP, justifyContent: 'center', paddingHorizontal: 20, borderRadius: 8, backgroundColor: theme.accent },
  saveText: { color: theme.bg, fontSize: 14, fontWeight: '700' },
  cancel: { minHeight: MIN_TAP, justifyContent: 'center', paddingHorizontal: 16, borderRadius: 8, borderWidth: 1, borderColor: theme.line },
  cancelText: { color: theme.textWeak, fontSize: 14, fontWeight: '600' },
  footnote: { color: theme.textWeaker, fontSize: 12, lineHeight: 17 }
});
