import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { PROVIDER_KEYS, readConnectedSlots, writeKey, type ProviderSlot } from '../lib/credentials';
import { theme } from '../lib/theme';

export function SettingsScreen({ topInset }: { readonly topInset: number }) {
  const [connected, setConnected] = useState<Readonly<Record<string, boolean>>>({});
  const [drafts, setDrafts] = useState<Readonly<Record<string, string>>>({});
  const [saved, setSaved] = useState<string | null>(null);

  useEffect(() => {
    void readConnectedSlots().then(setConnected);
  }, []);

  const save = async (slot: ProviderSlot): Promise<void> => {
    await writeKey(slot, drafts[slot] ?? '');
    // The draft is cleared rather than kept: holding the key in component state
    // after it is in the keystore serves no purpose and widens where it lives.
    setDrafts((current) => ({ ...current, [slot]: '' }));
    setConnected(await readConnectedSlots());
    setSaved(slot);
  };

  return (
    <ScrollView style={styles.root} contentContainerStyle={[styles.content, { paddingTop: topInset + 16 }]}>
      <Text style={styles.h1}>Providers</Text>
      <Text style={styles.sub}>
        Keys are held in the device keystore — Keychain on iOS, Keystore on Android — never in the app bundle or in
        plain storage.
      </Text>

      {PROVIDER_KEYS.map(({ slot, label, hint }) => (
        <View key={slot} style={styles.card}>
          <View style={styles.cardHead}>
            <Text style={styles.cardTitle}>{label}</Text>
            <Text style={[styles.badge, connected[slot] === true ? styles.badgeOn : styles.badgeOff]}>
              {connected[slot] === true ? 'connected' : 'not connected'}
            </Text>
          </View>
          <TextInput
            style={styles.input}
            value={drafts[slot] ?? ''}
            onChangeText={(value) => setDrafts((current) => ({ ...current, [slot]: value }))}
            placeholder={connected[slot] === true ? 'Replace the stored key' : hint}
            placeholderTextColor={theme.textWeaker}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
            accessibilityLabel={`${label} API key`}
          />
          {/* An empty field on a provider with nothing stored has no action to
              offer. Labelling that button "Clear" invited the user to delete a
              key that does not exist. */}
          {(() => {
            const draft = (drafts[slot] ?? '').trim();
            const isConnected = connected[slot] === true;
            const action = draft.length > 0 ? 'save' : isConnected ? 'clear' : 'none';
            return (
              <View style={styles.actions}>
                <Pressable
                  accessibilityRole="button"
                  disabled={action === 'none'}
                  onPress={() => void save(slot)}
                  style={[styles.save, action === 'none' && styles.saveOff, action === 'clear' && styles.saveClear]}
                >
                  <Text style={[styles.saveText, action === 'clear' && styles.saveClearText]}>
                    {action === 'clear' ? 'Remove stored key' : 'Save'}
                  </Text>
                </Pressable>
                {saved === slot && <Text style={styles.savedNote}>{isConnected ? 'Stored.' : 'Removed.'}</Text>}
              </View>
            );
          })()}
        </View>
      ))}

      <Text style={styles.footnote}>
        A stored key is never read back into the app for display — only whether one exists. Saving an empty field
        deletes it.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bg },
  content: { padding: 20, paddingBottom: 40, gap: 12 },
  h1: { color: theme.text, fontSize: 26, fontWeight: '700' },
  sub: { color: theme.textWeak, fontSize: 13, lineHeight: 19, marginBottom: 4 },
  card: { padding: 14, borderRadius: 12, backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.line, gap: 10 },
  cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardTitle: { color: theme.text, fontSize: 14, fontWeight: '600' },
  badge: { fontSize: 10, fontWeight: '700', letterSpacing: 0.6, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, overflow: 'hidden' },
  badgeOn: { color: theme.bg, backgroundColor: theme.mint },
  badgeOff: { color: theme.textWeaker, borderWidth: 1, borderColor: theme.line },
  input: {
    padding: 11,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: theme.line,
    backgroundColor: theme.bg,
    color: theme.text,
    fontSize: 13
  },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  save: { paddingHorizontal: 16, paddingVertical: 9, borderRadius: 8, backgroundColor: theme.accent },
  saveOff: { opacity: 0.35 },
  saveClear: { backgroundColor: 'transparent', borderWidth: 1, borderColor: theme.danger },
  saveText: { color: theme.bg, fontSize: 13, fontWeight: '700' },
  saveClearText: { color: theme.danger },
  savedNote: { color: theme.mint, fontSize: 12 },
  footnote: { color: theme.textWeaker, fontSize: 11, lineHeight: 17, marginTop: 4 }
});
