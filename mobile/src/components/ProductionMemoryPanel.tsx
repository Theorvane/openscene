import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import type { AiProjectDocument } from '@openvideo/shared/aiProjectDomain';
import { appendProductionMemory, buildProductionMemory, searchProductionMemory } from '@openvideo/shared/productionMemory';
import { theme } from '../lib/theme';
import { MIN_TAP, press } from '../lib/touch';

export function ProductionMemoryPanel({ projectId, document, prompt, onChange, disabled }: {
  readonly projectId: string; readonly document: AiProjectDocument; readonly prompt: string;
  readonly onChange: (value: string) => void; readonly disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [message, setMessage] = useState('');
  const index = useMemo(() => buildProductionMemory(projectId, document), [projectId, document]);
  const results = useMemo(() => searchProductionMemory(index, projectId, query), [index, projectId, query]);
  return <View style={styles.panel}>
    <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} style={press(styles.button)} onPress={() => setOpen(value => !value)}>
      <Text style={styles.text}>Project memory · local search</Text>
    </Pressable>
    {open && <>
      <Text style={styles.text}>Search stays on this device. Added references are sent to the selected provider when you generate. Review copied text again if its source changes.</Text>
      <TextInput accessibilityLabel="Search project memory" placeholder="Character name, dialogue or scene…" placeholderTextColor={theme.textWeaker}
        style={styles.input} value={query} maxLength={512} onChangeText={setQuery} />
      <Text style={styles.text}>{index.entries.length} excerpts · up to 5 matches · lexical, not semantic search.</Text>
      {index.truncated && <Text style={styles.text}>Limit reached: first 256 excerpts, up to 12,000 characters per source.</Text>}
      {query.trim() !== '' && results.length === 0 && <Text style={styles.text}>No matches. Approve the script before searching production shots.</Text>}
      {results.map(entry => <View key={entry.sourceId} style={styles.panel}>
        <Text style={styles.text}>{entry.title} · {entry.sourceId}</Text>
        <Text selectable style={styles.text}>{entry.text}</Text>
        <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} style={press(styles.button)} onPress={() => {
          const result = appendProductionMemory(prompt, entry, projectId);
          if (result.ok) { onChange(result.prompt); setMessage('Copied to prompt. Review before generating; edit the prompt to remove.'); }
          else setMessage(result.reason);
        }}><Text style={styles.text}>Add reference to prompt</Text></Pressable>
      </View>)}
      <Text accessibilityLiveRegion="polite" style={styles.text}>{message}</Text>
    </>}
  </View>;
}
const styles = StyleSheet.create({
  panel: { gap: 8, paddingVertical: 8 },
  text: { color: theme.text, fontSize: 13 },
  button: { minHeight: MIN_TAP, justifyContent: 'center', borderWidth: 1, borderColor: theme.line, padding: 8, borderRadius: 8 },
  input: { minHeight: MIN_TAP, color: theme.text, borderWidth: 1, borderColor: theme.line, padding: 8, borderRadius: 8 }
});
