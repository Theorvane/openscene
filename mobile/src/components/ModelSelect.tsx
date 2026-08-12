import { useMemo, useState } from 'react';
import { KeyboardAvoidingView, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { KeyboardAwareScroll } from './KeyboardAwareScroll';

import { getDomainModels, type AiDomain, type AiDomainModelConfig } from '@openvideo/shared/aiDomainModels';

import { describeProvider, providersForDomain } from '../lib/mediaProviders';
import { ProviderConnect } from './ProviderConnect';
import { theme } from '../lib/theme';
import { MIN_TAP, press } from '../lib/touch';

/**
 * A select for the current model, and a plus for getting more.
 *
 * The horizontal strip of chips it replaces did not survive the catalog
 * growing: seventeen runnable video models meant the choice was mostly
 * off-screen, and a row you have to scroll hides how much is in it. A select
 * shows one thing — what is chosen — and puts the rest one tap away, grouped by
 * provider so the list reads as "who can do this" rather than a flat wall.
 *
 * The plus is a different question from the select, which is why it is a
 * different control: the select chooses among models you can already run, the
 * plus connects a provider so there are more of them.
 */

export function ModelSelect({
  domain,
  selectedId,
  connected,
  onSelect,
  onConnectionChange
}: {
  readonly domain: AiDomain;
  readonly selectedId: string;
  /** Keyed by provider id. */
  readonly connected: Readonly<Record<string, boolean>>;
  readonly onSelect: (model: AiDomainModelConfig) => void;
  readonly onConnectionChange: () => void;
}) {
  const [sheet, setSheet] = useState<null | 'choose' | 'add'>(null);
  const models = useMemo(() => getDomainModels(domain), [domain]);
  const providers = useMemo(() => providersForDomain(domain), [domain]);
  const selected = models.find((model) => model.id === selectedId);

  // Grouped in the providers' order, which puts the ones you can actually use
  // first rather than however the catalog happens to be written.
  const grouped = useMemo(() => {
    const order = new Map(providers.map((provider, index) => [provider.providerId, index]));
    const byProvider = new Map<string, AiDomainModelConfig[]>();
    for (const model of models) {
      byProvider.set(model.providerId, [...(byProvider.get(model.providerId) ?? []), model]);
    }
    return [...byProvider.entries()].sort(
      ([left], [right]) => (order.get(left) ?? 99) - (order.get(right) ?? 99)
    );
  }, [models, providers]);

  const needsKey = selected !== undefined && selected.available && connected[selected.providerId] === false;

  return (
    <View style={styles.root}>
      <View style={styles.row}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Choose a model"
          onPress={() => setSheet('choose')}
          style={press(styles.select)}
        >
          <Text style={styles.model} numberOfLines={1}>
            {selected === undefined ? (
              'Connect a provider to pick one'
            ) : (
              <>
                <Text style={styles.provider}>{selected.providerLabel} · </Text>
                {selected.label}
              </>
            )}
          </Text>
          {/* A chevron rather than a glyph: it is drawn, so it matches the rest
              of the controls on both platforms. */}
          <View style={styles.chevron} />
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Add a provider"
          onPress={() => setSheet('add')}
          style={press(styles.plus)}
        >
          <View style={styles.plusBar} />
          <View style={[styles.plusBar, styles.plusBarVertical]} />
        </Pressable>
      </View>

      {needsKey && (
        <Text style={styles.needsKey}>
          {selected?.providerLabel} has no key stored — tap ＋ to connect it.
        </Text>
      )}

      <Modal visible={sheet !== null} animationType="slide" transparent onRequestClose={() => setSheet(null)}>
        {/* The add-a-provider sheet holds key fields, and a bottom sheet is
            where the keyboard opens. A Modal is its own window, so the calling
            screen's avoidance does not reach in here. */}
        <KeyboardAvoidingView style={styles.scrim} behavior="padding">
          <View style={styles.sheet}>
            <View style={styles.sheetHead}>
              <Text style={styles.sheetTitle}>{sheet === 'add' ? 'Add a provider' : 'Choose a model'}</Text>
              <Pressable accessibilityRole="button" onPress={() => setSheet(null)} style={press(styles.close)}>
                <Text style={styles.closeText}>Done</Text>
              </Pressable>
            </View>

            <KeyboardAwareScroll contentContainerStyle={styles.sheetBody} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
              {sheet === 'add' ? (
                <>
                  <Text style={styles.sheetBlurb}>
                    Connecting a provider makes its models selectable. Keys are held in the device keystore and never
                    read back for display.
                  </Text>
                  {providers.map((provider) => (
                    <ProviderConnect
                      key={provider.slot}
                      slot={provider.slot}
                      label={provider.label}
                      hint={provider.hint}
                      meta={describeProvider(provider)}
                      connected={connected[provider.providerId] === true}
                      onChange={onConnectionChange}
                    />
                  ))}
                </>
              ) : (
                grouped.map(([providerId, group]) => (
                  <View key={providerId} style={styles.group}>
                    <View style={styles.groupHead}>
                      <Text style={styles.groupTitle}>{group[0]?.providerLabel ?? providerId}</Text>
                      <Text style={[styles.groupBadge, connected[providerId] === true ? styles.on : styles.off]}>
                        {connected[providerId] === true ? 'connected' : 'no key'}
                      </Text>
                    </View>
                    {group.map((model) => {
                      const chosen = model.id === selectedId;
                      return (
                        <Pressable
                          key={model.id}
                          accessibilityRole="button"
                          accessibilityState={{ selected: chosen, disabled: !model.available }}
                          disabled={!model.available}
                          onPress={() => {
                            onSelect(model);
                            setSheet(null);
                          }}
                          style={press([styles.option, chosen && styles.optionOn, !model.available && styles.optionOff])}
                        >
                          <View style={styles.optionText}>
                            <Text style={styles.optionLabel}>{model.label}</Text>
                            <Text style={styles.optionMeta} numberOfLines={2}>
                              {/* Unavailable models stay listed with the reason: hiding them
                                  understates the app, and offering them hands the user a tap
                                  they cannot act on. */}
                              {model.available ? model.description : model.unavailableReason}
                            </Text>
                          </View>
                          {chosen && <View style={styles.tick} />}
                        </Pressable>
                      );
                    })}
                  </View>
                ))
              )}
            </KeyboardAwareScroll>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: 6 },
  row: { flexDirection: 'row', alignItems: 'stretch', gap: 8 },
  // Sized to sit level with the chip rows beside it — the stacked two-line
  // version stood about twice their height and read as the loudest thing on a
  // screen where it is one setting among several.
  select: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: MIN_TAP,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: theme.line,
    backgroundColor: theme.surface
  },
  provider: { color: theme.textWeaker, fontSize: 14, fontWeight: '600' },
  model: { flex: 1, color: theme.text, fontSize: 14, fontWeight: '600' },
  chevron: {
    width: 7,
    height: 7,
    borderRightWidth: 1.5,
    borderBottomWidth: 1.5,
    borderColor: theme.textWeak,
    transform: [{ rotate: '45deg' }],
    marginBottom: 3
  },
  plus: {
    width: MIN_TAP,
    height: MIN_TAP,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: theme.accent,
    alignItems: 'center',
    justifyContent: 'center'
  },
  plusBar: { position: 'absolute', width: 13, height: 1.5, borderRadius: 1, backgroundColor: theme.accent },
  plusBarVertical: { transform: [{ rotate: '90deg' }] },
  needsKey: { color: theme.warn, fontSize: 12, lineHeight: 17 },

  scrim: { flex: 1, backgroundColor: '#000000cc', justifyContent: 'flex-end' },
  sheet: { maxHeight: '86%', backgroundColor: theme.bg, borderTopLeftRadius: 18, borderTopRightRadius: 18, borderTopWidth: 1, borderColor: theme.line },
  sheetHead: { flexDirection: 'row', alignItems: 'center', padding: 16, borderBottomWidth: 1, borderBottomColor: theme.line },
  sheetTitle: { flex: 1, color: theme.text, fontSize: 17, fontWeight: '700' },
  close: { minHeight: MIN_TAP, justifyContent: 'center', paddingHorizontal: 16, borderRadius: 8, backgroundColor: theme.accent },
  closeText: { color: theme.bg, fontSize: 14, fontWeight: '700' },
  sheetBody: { padding: 16, paddingBottom: 40, gap: 10 },
  sheetBlurb: { color: theme.textWeak, fontSize: 13, lineHeight: 19 },

  group: { gap: 5 },
  groupHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 },
  groupTitle: { flex: 1, color: theme.text, fontSize: 14, fontWeight: '700' },
  groupBadge: { fontSize: 11, fontWeight: '700', letterSpacing: 0.4, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 5, overflow: 'hidden', borderWidth: 1 },
  on: { color: theme.mint, borderColor: theme.mint },
  off: { color: theme.textWeaker, borderColor: theme.line },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: MIN_TAP,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: theme.line,
    backgroundColor: theme.surface
  },
  optionOn: { borderColor: theme.accent },
  optionOff: { opacity: 0.45 },
  optionText: { flex: 1 },
  optionLabel: { color: theme.text, fontSize: 14, fontWeight: '600' },
  optionMeta: { color: theme.textWeaker, fontSize: 12, lineHeight: 16, marginTop: 2 },
  tick: { width: 8, height: 8, borderRadius: 4, backgroundColor: theme.accent }
});
