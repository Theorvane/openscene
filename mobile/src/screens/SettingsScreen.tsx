import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';

import { openAdTestSuite } from '../lib/adsModule';
import { PROVIDER_KEYS, readSlot } from '../lib/credentials';
import { useAnalyticsPreference } from '../lib/analyticsClient';
import { SPEND_FEATURES, useSpendPermissions } from '../lib/permissions';
import { describeProvider, providersForDomain } from '../lib/mediaProviders';
import { ProviderConnect } from '../components/ProviderConnect';
import { AddCustomProvider } from '../components/AddCustomProvider';
import { customCredentialKey, removeCustomProvider, useCustomProviders } from '../lib/customProviders';
import { LLM_PROVIDERS, POPULAR_LLM_PROVIDER_IDS, getLlmCatalogProvider } from '@openvideo/shared/llmProviders';
import { FormScreen } from '../components/FormScreen';
import { APP_VERSION, CONTACT_EMAIL, DEVELOPER_NAME, DEVELOPER_SITE, PRIVACY_URL, TERMS_URL } from '../lib/about';
import { theme } from '../lib/theme';
import { MIN_TAP, press } from '../lib/touch';

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
  const analytics = useAnalyticsPreference();
  const { providers: customProviders, refresh: refreshCustom } = useCustomProviders();
  /**
   * What the Test Suite tap did. Null until asked, so the row reads "Open".
   * Launching it is a native screen appearing over this one, and a launch that
   * failed looks exactly like a tap that missed — so it says which.
   */
  const [testSuite, setTestSuite] = useState<'opening' | 'opened' | 'no-sdk' | 'no-init' | null>(null);

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
    <FormScreen topInset={topInset}>
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
              style={press(styles.removeCustom)}
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
                <Pressable accessibilityRole="button" onPress={() => permissions.forget(feature)} style={press(styles.permReset)}>
                  <Text style={styles.permResetText}>Reset</Text>
                </Pressable>
              )}
            </View>
          );
        })}
      </View>

      {/*
        Usage reporting, and the switch for it.

        Sits above About rather than buried in it, because a thing that sends
        data should be as easy to find as the policy describing it. On by
        default and stated plainly: the counts are how the publisher knows which
        parts of the app are worth working on, and nothing about what the user
        writes or edits is in them.
      */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Usage reporting</Text>
        <Text style={styles.sectionBlurb}>
          Anonymous counts — how often an export runs or finishes, and which screens get used — sent to the developer’s own
          server rather than to a third party. Never your prompts, projects, media, file names, or keys, and there is no
          account to attach any of it to.
        </Text>
        <Pressable
          accessibilityRole="switch"
          accessibilityState={{ checked: analytics.enabled }}
          accessibilityLabel="Send anonymous usage counts"
          onPress={() => analytics.set(!analytics.enabled)}
          style={press(styles.permRow)}
        >
          <Text style={styles.switchLabel}>Send anonymous usage counts</Text>
          <Text style={[styles.permValue, analytics.enabled && styles.aboutLink]}>{analytics.enabled ? 'on' : 'off'}</Text>
        </Pressable>
      </View>

      {/*
        The only way to see an ad while building.

        LevelPlay publishes no test ad units, so `src/lib/ads.ts` hands a
        development build none and both placements stay empty — which is
        indistinguishable from an integration that does not work. The Test Suite
        is the answer to that: it serves from the dashboard rather than from live
        inventory, lists every configured network with whether its adapter is
        actually in this binary, and loads a test ad per placement.

        Behind `__DEV__`, so it is compiled out of a store build rather than
        merely hidden in one. It is a debugging surface, and a user finding it
        would be finding ads they cannot dismiss from a screen that explains
        nothing.
      */}
      {__DEV__ && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Ad mediation (development only)</Text>
          <Text style={styles.sectionBlurb}>
            LevelPlay’s Test Suite. Shows which of the five networks — ironSource, Unity Ads, AppLovin, Meta, Pangle —
            actually made it into this binary, and loads a test ad for each placement. Development builds request no
            live ad, so this is the only place an ad appears before a store build.
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Open the LevelPlay test suite"
            onPress={() => {
              setTestSuite('opening');
              void openAdTestSuite().then(setTestSuite);
            }}
            style={press(styles.aboutRow)}
          >
            <Text style={styles.aboutLabel}>Test suite</Text>
            <Text style={[styles.aboutValue, testSuite === null && styles.aboutLink]}>
              {testSuite === null
                ? 'Open'
                : testSuite === 'opening'
                  ? 'Opening…'
                  : testSuite === 'opened'
                    ? 'Opened'
                    : testSuite === 'no-sdk'
                      ? 'Needs a development build'
                      : 'Could not initialise'}
            </Text>
          </Pressable>
        </View>
      )}

      {/*
        Who made this, and where to find them.

        An app that carries ads is a published thing rather than a personal
        build, and both the stores and the ad network expect a publisher a user
        can identify and reach. The site is the place a privacy policy lives,
        which serving ads also requires.
      */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>About</Text>
        <View style={styles.aboutRow}>
          <Text style={styles.aboutLabel}>Developer</Text>
          <Text style={styles.aboutValue}>{DEVELOPER_NAME}</Text>
        </View>
        <Pressable
          accessibilityRole="link"
          accessibilityLabel={`Open ${DEVELOPER_SITE}`}
          onPress={() => void WebBrowser.openBrowserAsync(`https://${DEVELOPER_SITE}`)}
          style={press(styles.aboutRow)}
        >
          <Text style={styles.aboutLabel}>Site</Text>
          <Text style={[styles.aboutValue, styles.aboutLink]}>{DEVELOPER_SITE}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="link"
          accessibilityLabel={`Email ${CONTACT_EMAIL}`}
          onPress={() => void Linking.openURL(`mailto:${CONTACT_EMAIL}`)}
          style={press(styles.aboutRow)}
        >
          <Text style={styles.aboutLabel}>Contact</Text>
          <Text style={[styles.aboutValue, styles.aboutLink]}>{CONTACT_EMAIL}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="link"
          accessibilityLabel="Open the privacy policy"
          onPress={() => void WebBrowser.openBrowserAsync(PRIVACY_URL)}
          style={press(styles.aboutRow)}
        >
          <Text style={styles.aboutLabel}>Privacy policy</Text>
          <Text style={[styles.aboutValue, styles.aboutLink]}>Open</Text>
        </Pressable>
        <Pressable
          accessibilityRole="link"
          accessibilityLabel="Open the terms of service"
          onPress={() => void WebBrowser.openBrowserAsync(TERMS_URL)}
          style={press(styles.aboutRow)}
        >
          <Text style={styles.aboutLabel}>Terms of service</Text>
          <Text style={[styles.aboutValue, styles.aboutLink]}>Open</Text>
        </Pressable>
        <View style={styles.aboutRow}>
          <Text style={styles.aboutLabel}>Version</Text>
          <Text style={styles.aboutValue}>{APP_VERSION}</Text>
        </View>
      </View>
    </FormScreen>
  );
}

const styles = StyleSheet.create({
  aboutRow: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: MIN_TAP, borderBottomWidth: 1, borderBottomColor: theme.line },
  aboutLabel: { flex: 1, color: theme.text, fontSize: 14 },
  aboutValue: { color: theme.textWeak, fontSize: 13 },
  aboutLink: { color: theme.accent, fontWeight: '600' },
  h1: { color: theme.text, fontSize: 26, fontWeight: '700' },
  sub: { color: theme.textWeak, fontSize: 13, lineHeight: 19, marginBottom: 6 },
  section: { marginTop: 22, gap: 10 },
  sectionTitle: { color: theme.text, fontSize: 17, fontWeight: '700' },
  sectionBlurb: { color: theme.textWeak, fontSize: 13, lineHeight: 19, marginBottom: 2 },
  customRow: { gap: 6 },
  removeCustom: { alignSelf: 'flex-start', justifyContent: 'center', minHeight: MIN_TAP, paddingHorizontal: 14, borderRadius: 8, borderWidth: 1, borderColor: theme.line },
  removeCustomText: { color: theme.textWeaker, fontSize: 13, fontWeight: '600' },
  permRow: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 56, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: theme.line },
  // Capitalised because the spend rows render a feature id — "image", "video" —
  // rather than a sentence. A label that is already a sentence needs its own
  // style, or it comes out as "Send Anonymous Usage Counts".
  permLabel: { flex: 1, color: theme.text, fontSize: 14, textTransform: 'capitalize' },
  switchLabel: { flex: 1, color: theme.text, fontSize: 14 },
  permValue: { color: theme.textWeak, fontSize: 13 },
  permReset: { justifyContent: 'center', minHeight: MIN_TAP, paddingHorizontal: 14, borderRadius: 8, borderWidth: 1, borderColor: theme.line },
  permResetText: { color: theme.textWeak, fontSize: 13, fontWeight: '600' }
});
