import { useCallback, useEffect, useState } from 'react';
import { Alert, Image, Pressable, StyleSheet, Text, View } from 'react-native';

import {
  appendAssetToTimeline,
  assetByteLength,
  assetUri,
  deleteAsset,
  readProject,
  type MobileAsset
} from '../lib/projectStore';
import { STILL_DEFAULT_HOLD_MS } from '@openvideo/shared/timelineStills';
import { deliverExport } from '../lib/exportComposition';
import { FormScreen } from '../components/FormScreen';
import { CloseIcon } from '../components/Icon';
import { theme } from '../lib/theme';
import { MIN_TAP, press } from '../lib/touch';

/**
 * Everything the project holds, in one place.
 *
 * A generated shot went straight onto the timeline and a generated still went
 * nowhere at all, so there was no answer to "what have I made?" — only the cut,
 * which is a different question. The Media panel in the editing toolbar came
 * closest, but it is a toggle inside the tool that uses it, and it only ever
 * listed what could be placed.
 *
 * Stills and clips sit together because the user made them the same way and
 * thinks of them the same way. What differs is what can be done with each: a
 * clip can go on the timeline, a still cannot, and saying so on the row is
 * clearer than two lists that need explaining.
 */

type Filter = 'all' | 'generated' | 'imported';

function formatBytes(bytes: number | null): string {
  if (bytes === null) return 'missing';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function describe(asset: MobileAsset, bytes: number | null): string {
  const size = formatBytes(bytes);
  if (asset.kind === 'image') return `still · ${size}`;
  return `${(asset.durationMs / 1000).toFixed(1)}s · ${size}`;
}

export function LibraryScreen({
  topInset,
  keyboardOffset,
  projectId
}: {
  readonly topInset: number;
  /** Height of the chrome above this screen; see FormScreen. */
  readonly keyboardOffset: number;
  readonly projectId: string | null;
}) {
  const [assets, setAssets] = useState<readonly MobileAsset[]>([]);
  const [usage, setUsage] = useState<Readonly<Record<string, number>>>({});
  const [filter, setFilter] = useState<Filter>('all');
  const [note, setNote] = useState<string | null>(null);

  const refresh = useCallback((): void => {
    if (projectId === null) {
      setAssets([]);
      setUsage({});
      return;
    }
    const project = readProject(projectId);
    if (project === null) return;
    setAssets(project.assets);
    const counts: Record<string, number> = {};
    for (const track of project.timeline.tracks) {
      for (const clip of track.clips) counts[clip.assetId] = (counts[clip.assetId] ?? 0) + 1;
    }
    setUsage(counts);
  }, [projectId]);

  useEffect(refresh, [refresh]);

  const place = (asset: MobileAsset): void => {
    if (projectId === null) return;
    const project = readProject(projectId);
    if (project === null) return;
    setNote(
      appendAssetToTimeline(project, asset) === null
        ? 'No video track would take that clip.'
        : asset.kind === 'image'
          ? `${asset.displayName} added, held for ${STILL_DEFAULT_HOLD_MS / 1000}s — trim it on the Edit tab.`
          : `${asset.displayName} added to the timeline.`
    );
    refresh();
  };

  /** The photo library, or the share sheet — the same route a finished export takes. */
  const keep = async (asset: MobileAsset): Promise<void> => {
    if (projectId === null) return;
    const delivery = await deliverExport(assetUri(projectId, asset));
    setNote(
      delivery.ok
        ? delivery.how === 'photos'
          ? 'Saved to your photo library.'
          : 'Handed to the app you chose.'
        : delivery.message
    );
  };

  const confirmDelete = (asset: MobileAsset): void => {
    const used = usage[asset.id] ?? 0;
    // Deleting takes the file, and with it every clip cut from it.
    Alert.alert(
      'Delete from the project',
      used === 0
        ? `Delete “${asset.displayName}”? This cannot be undone.`
        : `Delete “${asset.displayName}” and the ${used} clip${used === 1 ? '' : 's'} using it? This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            if (projectId === null) return;
            deleteAsset(projectId, asset.id);
            setNote(`${asset.displayName} deleted.`);
            refresh();
          }
        }
      ]
    );
  };

  const shown = assets.filter((asset) => {
    if (filter === 'all') return true;
    const generated = asset.origin?.kind === 'generated';
    return filter === 'generated' ? generated : !generated;
  });

  return (
    <FormScreen topInset={topInset} keyboardOffset={keyboardOffset} contentStyle={styles.content}>
      <Text style={styles.h1}>Library</Text>
      <Text style={styles.sub}>
        Everything this project holds — clips you imported, shots and stills the app generated. Deleting is per
        project: nothing here touches your phone&apos;s own photo library unless you save it there.
      </Text>

      <View style={styles.row}>
        {(['all', 'generated', 'imported'] as const).map((option) => (
          <Pressable
            key={option}
            accessibilityRole="button"
            accessibilityState={{ selected: option === filter }}
            onPress={() => setFilter(option)}
            style={press([styles.chip, option === filter && styles.chipOn])}
          >
            <Text style={[styles.chipText, option === filter && styles.chipTextOn]}>{option}</Text>
          </Pressable>
        ))}
      </View>

      {note !== null && (
        <Pressable accessibilityRole="button" onPress={() => setNote(null)} style={press(styles.note)}>
          <Text style={styles.noteText}>{note}</Text>
        </Pressable>
      )}

      {projectId === null ? (
        <Text style={styles.empty}>Open a project to see what it holds.</Text>
      ) : shown.length === 0 ? (
        <Text style={styles.empty}>
          {filter === 'generated'
            ? 'Nothing generated yet. Shots come from the Video tab, stills from Image or the assistant.'
            : filter === 'imported'
              ? 'Nothing imported yet. Import a clip from the Edit tab.'
              : 'Nothing here yet. Import a clip, or generate a shot or a still.'}
        </Text>
      ) : (
        shown.map((asset) => {
          const used = usage[asset.id] ?? 0;
          return (
            <View key={asset.id} style={styles.card}>
              <View style={styles.head}>
                {asset.kind === 'image' && (
                  <Image
                    style={styles.thumb}
                    source={{ uri: assetUri(projectId, asset) }}
                    accessibilityLabel={asset.displayName}
                    resizeMode="cover"
                  />
                )}
                <View style={styles.headText}>
                  <Text style={styles.name} numberOfLines={1}>
                    {asset.displayName}
                  </Text>
                  <Text style={styles.meta}>
                    {describe(asset, assetByteLength(projectId, asset))} ·{' '}
                    {used === 0 ? 'not on the timeline' : `${used} clip${used === 1 ? '' : 's'}`}
                  </Text>
                  {asset.origin?.kind === 'generated' && (
                    <Text style={styles.prompt} numberOfLines={3}>
                      {asset.origin.prompt.length === 0 ? asset.origin.modelId : `“${asset.origin.prompt}”`}
                    </Text>
                  )}
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Delete ${asset.displayName}`}
                  onPress={() => confirmDelete(asset)}
                  style={press(styles.iconButton)}
                >
                  <CloseIcon size={15} color={theme.danger} />
                </Pressable>
              </View>

              <View style={styles.actions}>
                <Pressable accessibilityRole="button" onPress={() => place(asset)} style={press(styles.action)}>
                  <Text style={styles.actionText}>Add to timeline</Text>
                </Pressable>
                <Pressable accessibilityRole="button" onPress={() => void keep(asset)} style={press(styles.action)}>
                  <Text style={styles.actionText}>Save or share</Text>
                </Pressable>
              </View>
            </View>
          );
        })
      )}
    </FormScreen>
  );
}

const styles = StyleSheet.create({
  content: { gap: 10 },
  h1: { color: theme.text, fontSize: 26, fontWeight: '700' },
  sub: { color: theme.textWeak, fontSize: 13, lineHeight: 19, marginBottom: 6 },
  row: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  chip: { minHeight: MIN_TAP, justifyContent: 'center', paddingHorizontal: 16, borderRadius: 10, borderWidth: 1, borderColor: theme.line },
  chipOn: { backgroundColor: theme.accent, borderColor: theme.accent },
  chipText: { color: theme.textWeak, fontSize: 14, fontWeight: '600', textTransform: 'capitalize' },
  chipTextOn: { color: theme.bg },
  note: { minHeight: MIN_TAP, justifyContent: 'center', paddingHorizontal: 14, borderRadius: 10, borderWidth: 1, borderColor: theme.mint },
  noteText: { color: theme.mint, fontSize: 13, lineHeight: 18 },
  empty: { color: theme.textWeak, fontSize: 14, lineHeight: 20, marginTop: 12 },
  card: { padding: 12, borderRadius: 12, borderWidth: 1, borderColor: theme.line, backgroundColor: theme.surface, gap: 10 },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  thumb: { width: 64, height: 64, borderRadius: 8, backgroundColor: theme.bg },
  headText: { flex: 1 },
  name: { color: theme.text, fontSize: 15, fontWeight: '600' },
  meta: { color: theme.textWeaker, fontSize: 12, marginTop: 3, fontVariant: ['tabular-nums'] },
  prompt: { color: theme.textWeak, fontSize: 13, lineHeight: 18, marginTop: 6 },
  iconButton: { width: MIN_TAP, height: MIN_TAP, alignItems: 'center', justifyContent: 'center' },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  action: { minHeight: MIN_TAP, justifyContent: 'center', paddingHorizontal: 14, borderRadius: 8, borderWidth: 1, borderColor: theme.line },
  actionText: { color: theme.text, fontSize: 13, fontWeight: '600' },
});
