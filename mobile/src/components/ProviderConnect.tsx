import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { readSlot, writeSlot } from '../lib/credentials';
import { useRevealOnFocus } from './KeyboardAwareScroll';
import { isSignedIn, signInWithChatGpt, signOut } from '../lib/openAiSignIn';
import { theme } from '../lib/theme';
import { MIN_TAP, press } from '../lib/touch';

/**
 * Connect a provider where you need it, not somewhere else.
 *
 * The picker used to say "add a key in Settings", which is a instruction, not a
 * control: the user had to leave the thing they were doing, find one provider in
 * a long list, and come back. Generation is gated on exactly one provider at a
 * time — the one whose model is selected — so that is the only one worth putting
 * in front of them, and it belongs on the screen that is blocked without it.
 *
 * The same component backs the Settings list, so there is one connect flow
 * rather than two that drift.
 */

export function ProviderConnect({
  slot,
  label,
  hint,
  meta,
  connected,
  onChange,
  compact,
  chatGptSignIn
}: {
  readonly slot: string;
  readonly label: string;
  readonly hint: string;
  readonly meta?: string;
  readonly connected: boolean;
  /** Fired after the keystore changed, so callers can re-read connection state. */
  readonly onChange: () => void;
  /** Inline form used beside a model picker; the full card is for Settings. */
  readonly compact?: boolean;
  /** OpenAI alone offers a second way in: a ChatGPT account instead of a key. */
  readonly chatGptSignIn?: boolean;
}) {
  const reveal = useRevealOnFocus();
  const input = useRef<TextInput>(null);
  const [draft, setDraft] = useState('');
  const [note, setNote] = useState<string | null>(null);
  const [signedIn, setSignedIn] = useState(false);
  const [busy, setBusy] = useState(false);
  // Collapsed by default when connected: a filled-in key field invites editing
  // something that is already working.
  const [open, setOpen] = useState(!connected);

  useEffect(() => {
    setOpen(!connected);
  }, [connected]);

  useEffect(() => {
    if (chatGptSignIn === true) void isSignedIn().then(setSignedIn);
  }, [chatGptSignIn, connected]);

  const save = useCallback(async (): Promise<void> => {
    const value = draft.trim();
    await writeSlot(slot, value);
    // Never held in state after it reaches the keystore: that only widens where
    // the key lives.
    setDraft('');
    setNote(value.length > 0 ? 'Stored.' : 'Removed.');
    onChange();
  }, [draft, slot, onChange]);

  const action = draft.trim().length > 0 ? 'save' : connected ? 'clear' : 'none';

  return (
    <View style={[styles.root, compact === true ? styles.compact : styles.card]}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((value) => !value)}
        style={press(styles.head)}
      >
        <View style={styles.headText}>
          <Text style={styles.title}>{label}</Text>
          {meta !== undefined && <Text style={styles.meta}>{meta}</Text>}
        </View>
        <Text style={[styles.badge, connected ? styles.badgeOn : styles.badgeOff]}>
          {connected ? 'connected' : 'not connected'}
        </Text>
      </Pressable>

      {open && (
        <>
          <TextInput
            ref={input}
            onFocus={() => reveal(input.current)}
            style={styles.input}
            value={draft}
            onChangeText={setDraft}
            placeholder={connected ? 'Replace the stored key' : hint}
            placeholderTextColor={theme.textWeaker}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
            returnKeyType="done"
            onSubmitEditing={() => void save()}
            accessibilityLabel={`${label} API key`}
          />
          {/* An empty field on a provider with nothing stored has no action to
              offer. Labelling that button "Clear" invited the user to delete a
              key that does not exist. */}
          <View style={styles.actions}>
            <Pressable
              accessibilityRole="button"
              disabled={action === 'none'}
              onPress={() => void save()}
              style={press([styles.save, action === 'none' && styles.saveOff, action === 'clear' && styles.saveClear])}
            >
              <Text style={[styles.saveText, action === 'clear' && styles.saveClearText]}>
                {action === 'clear' ? 'Remove stored key' : 'Save'}
              </Text>
            </Pressable>
            {note !== null && <Text style={styles.note}>{note}</Text>}
          </View>
          {chatGptSignIn === true && (
            <>
              <Text style={styles.or}>or</Text>
              <Pressable
                accessibilityRole="button"
                disabled={busy}
                onPress={() => {
                  setBusy(true);
                  const finish = (message: string | null): void => {
                    setBusy(false);
                    setNote(message);
                    void isSignedIn().then(setSignedIn);
                    onChange();
                  };
                  if (signedIn) {
                    void signOut().then(() => finish('Signed out.'));
                    return;
                  }
                  void signInWithChatGpt().then((result) =>
                    finish(result.ok ? 'Signed in.' : result.message)
                  );
                }}
                style={press([styles.oauth, busy && styles.oauthBusy])}
              >
                <Text style={styles.oauthText}>
                  {busy ? 'Opening…' : signedIn ? 'Sign out of ChatGPT' : 'Sign in with ChatGPT'}
                </Text>
              </Pressable>
              <Text style={styles.footnote}>
                Opens your browser, so the password is typed there and never in this app. Serves only the models that
                backend runs; a key reaches everything else.
              </Text>
            </>
          )}
          <Text style={styles.footnote}>
            Held in the device keystore — Keychain on iOS, Keystore on Android. Never read back for display.
          </Text>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: 8 },
  card: { padding: 14, borderRadius: 12, borderWidth: 1, borderColor: theme.line, backgroundColor: theme.surface },
  compact: { padding: 12, borderRadius: 10, borderWidth: 1, borderColor: theme.warn, backgroundColor: theme.surface },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: MIN_TAP },
  headText: { flex: 1 },
  title: { color: theme.text, fontSize: 15, fontWeight: '700' },
  meta: { color: theme.textWeaker, fontSize: 12, marginTop: 3 },
  badge: { fontSize: 11, fontWeight: '700', letterSpacing: 0.4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, overflow: 'hidden' },
  badgeOn: { color: theme.mint, borderWidth: 1, borderColor: theme.mint },
  badgeOff: { color: theme.textWeaker, borderWidth: 1, borderColor: theme.line },
  input: {
    minHeight: MIN_TAP,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: theme.line,
    backgroundColor: theme.bg,
    color: theme.text,
    fontSize: 15
  },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  save: { minHeight: MIN_TAP, justifyContent: 'center', paddingHorizontal: 18, borderRadius: 8, backgroundColor: theme.accent },
  saveOff: { opacity: 0.35 },
  saveClear: { backgroundColor: 'transparent', borderWidth: 1, borderColor: theme.danger },
  saveText: { color: theme.bg, fontSize: 14, fontWeight: '700' },
  saveClearText: { color: theme.danger },
  note: { color: theme.mint, fontSize: 12 },
  or: { color: theme.textWeaker, fontSize: 12, textAlign: 'center', marginTop: 2 },
  oauth: { minHeight: MIN_TAP, justifyContent: 'center', borderRadius: 9, alignItems: 'center', borderWidth: 1, borderColor: theme.accent },
  oauthBusy: { opacity: 0.5 },
  oauthText: { color: theme.accent, fontSize: 14, fontWeight: '700' },
  footnote: { color: theme.textWeaker, fontSize: 12, lineHeight: 17 }
});
