import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { PROVIDER_KEYS, readSlot } from '../lib/credentials';
import { SPEND_FEATURES, useSpendPermissions } from '../lib/permissions';
import { describeProvider, providersForDomain } from '../lib/mediaProviders';
import { ProviderConnect } from '../components/ProviderConnect';
import { AddCustomProvider } from '../components/AddCustomProvider';
import { customCredentialKey, removeCustomProvider, useCustomProviders } from '../lib/customProviders';
import { LLM_PROVIDERS, POPULAR_LLM_PROVIDER_IDS, getLlmCatalogProvider } from '@openvideo/shared/llmProviders';
import { theme } from '../lib/theme';

/**
 * Providers, grouped by what connecting one lets you do.
 *
 * A flat list of every credential answered "what keys exist" and never "what do
 * I need for the thing I am trying to do". Generation is chosen per domain, so
 * the keys are presented per domain — and a provider that serves two, as OpenAI
 * serves both video and images, appears under both, because in each place it
 * answers a different question. It is one key underneath: the LLM catalog and
 * the media table name the same slot, so connecting it anywhere connects it
 * everywhere, which is why connection state is read by slot and not by section.
 */

const MEDIA_SECTIONS = [
  { domain: 'video-generation', title: 'Video', blurb: 'Engines that render shots.' },
  { domain: 'image-generation', title: 'Images', blurb: 'Stills, and reference frames for video.' },
  { domain: 'voice-generation', title: 'Voice', blurb: 'Narration. Synthesis is not ported to mobile yet.' }
] as const;

type Row = { readonly slot: string; readonly label: string; readonly hint: string; readonly meta: string };

/** Chat providers: the popular ones, for the assistant rather than for media. */
function chatRows(): readonly Row[] {
  const rows: Row[] = [];
  for (const id of POPULAR_LLM_PROVIDER_IDS) {
    const provider = LLM_PROVIDERS.find((entry) => entry.id === id);
    if (provider?.credentialKey === undefined) continue;
    rows.push({
      slot: provider.credentialKey,
      label: provider.label,
      hint: provider.keyPlaceholder ?? 'API key',
      meta: `${getLlmCatalogProvider(provider.id)?.models.length ?? 0} chat models`
    });
  }
  return rows;
}

export function SettingsScreen({ topInset }: { readonly topInset: number }) {
  const [connected, setConnected] = useState<Readonly<Record<string, boolean>>>({});
  const permissions = useSpendPermissions();
  const { providers: customProviders, refresh: refreshCustom } = useCustomProviders();

  const refresh = useCallback(async (): Promise<void> => {
    const slots = new Set<string>([
      ...PROVIDER_KEYS.map((entry) => entry.slot),
      ...chatRows().map((row) => row.slot),
      ...customProviders.map((provider) => customCredentialKey(provider.id))
    ]);
    const entries = await Promise.all([...slots].map(async (slot) => [slot, (await readSlot(slot)) !== null] as const));
    setConnected(Object.fromEntries(entries));
  }, [customProviders]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <ScrollView style={styles.root} contentContainerStyle={[styles.content, { paddingTop: topInset + 16 }]}>
      <Text style={styles.h1}>Providers</Text>
      <Text style={styles.sub}>
        Everything the app generates runs against your own accounts. Keys are held in the device keystore — Keychain on
        iOS, Keystore on Android — never in the app bundle or in plain storage, and never read back for display.
      </Text>

      {MEDIA_SECTIONS.map((section) => (
        <View key={section.domain} style={styles.section}>
          <Text style={styles.sectionTitle}>{section.title}</Text>
          <Text style={styles.sectionBlurb}>{section.blurb}</Text>
          {providersForDomain(section.domain).map((provider) => (
            <ProviderConnect
              key={`${section.domain}-${provider.slot}`}
              slot={provider.slot}
              label={provider.label}
              hint={provider.hint}
              meta={describeProvider(provider)}
              connected={connected[provider.slot] === true}
              onChange={() => void refresh()}
            />
          ))}
        </View>
      ))}

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Assistant</Text>
        <Text style={styles.sectionBlurb}>Models the AI tab can talk to and call tools with.</Text>
        {customProviders.map((provider) => (
          <View key={provider.id} style={styles.customRow}>
            <ProviderConnect
              slot={customCredentialKey(provider.id)}
              label={provider.label}
              hint="API key"
              meta={`${provider.models.length} model${provider.models.length === 1 ? '' : 's'} · ${provider.baseUrl}`}
              connected={connected[customCredentialKey(provider.id)] === true}
              onChange={() => void refresh()}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Remove ${provider.label}`}
              onPress={() => {
                removeCustomProvider(provider.id);
                refreshCustom();
              }}
              style={styles.removeCustom}
            >
              <Text style={styles.removeCustomText}>Remove this provider</Text>
            </Pressable>
          </View>
        ))}
        {chatRows().map((row) => (
          <ProviderConnect
            key={`chat-${row.slot}`}
            slot={row.slot}
            label={row.label}
            hint={row.hint}
            meta={row.meta}
            connected={connected[row.slot] === true}
            onChange={() => void refresh()}
            chatGptSignIn={row.slot === 'openaiApiKey'}
          />
        ))}
        <AddCustomProvider onAdded={refreshCustom} />
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Spending permissions</Text>
        <Text style={styles.sectionBlurb}>
          Generation charges your own provider account, so each kind asks before the first one. “Always” is remembered
          per kind — allowing every image is a different decision from allowing every video, and they do not cost the
          same.
        </Text>
        {SPEND_FEATURES.map((feature) => {
          const standing = permissions.standingFor(feature);
          return (
            <View key={feature} style={styles.permRow}>
              <Text style={styles.permLabel}>{feature.replace('-generation', '')}</Text>
              <Text style={styles.permValue}>{standing === null ? 'asks each time' : standing}</Text>
              {standing !== null && (
                <Pressable accessibilityRole="button" onPress={() => permissions.forget(feature)} style={styles.permReset}>
                  <Text style={styles.permResetText}>Reset</Text>
                </Pressable>
              )}
            </View>
          );
        })}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bg },
  content: { padding: 20, paddingBottom: 60, gap: 6 },
  h1: { color: theme.text, fontSize: 26, fontWeight: '700' },
  sub: { color: theme.textWeak, fontSize: 13, lineHeight: 19, marginBottom: 6 },
  section: { marginTop: 22, gap: 10 },
  sectionTitle: { color: theme.text, fontSize: 16, fontWeight: '700' },
  sectionBlurb: { color: theme.textWeak, fontSize: 12, lineHeight: 18, marginBottom: 2 },
  customRow: { gap: 6 },
  removeCustom: { alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 6, borderWidth: 1, borderColor: theme.line },
  removeCustomText: { color: theme.textWeaker, fontSize: 10, fontWeight: '600' },
  permRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: theme.line },
  permLabel: { flex: 1, color: theme.text, fontSize: 13, textTransform: 'capitalize' },
  permValue: { color: theme.textWeak, fontSize: 12 },
  permReset: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6, borderWidth: 1, borderColor: theme.line },
  permResetText: { color: theme.textWeak, fontSize: 11, fontWeight: '600' }
});
