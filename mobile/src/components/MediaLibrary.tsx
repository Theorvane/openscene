import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { mediaLibraryView, MEDIA_LIBRARY_SORTS, type MediaLibrarySort } from '@openvideo/shared/mediaLibraryView';
import { assetByteLength, type MobileAsset } from '../lib/projectStore';
import { theme } from '../lib/theme';
import { MIN_TAP, press } from '../lib/touch';

/**
 * The project's media, and what the timeline is doing with it.
 *
 * Without this the only route onto the timeline was importing again, and a
 * generated shot that had been deleted from the cut was invisible but still on
 * disk — the user had no way to see what their project was actually holding, let
 * alone reclaim the space.
 */

function formatBytes(bytes: number | null): string {
  if (bytes === null) return 'missing';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function MediaLibrary({
  projectId,
  assets,
  usage,
  onAdd,
  onDelete
}: {
  readonly projectId: string;
  readonly assets: readonly MobileAsset[];
  /** How many clips reference each asset id. */
  readonly usage: Readonly<Record<string, number>>;
  readonly onAdd: (assetId: string) => void;
  readonly onDelete: (assetId: string) => void;
}) {
  const [confirming, setConfirming] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<MediaLibrarySort>('project');
  const visibleAssets = mediaLibraryView(assets, { query, sort, durationMs: (asset) => asset.durationMs });
  const sortLabel = sort === 'project' ? 'Project' : sort === 'name' ? 'Name' : sort === 'type' ? 'Type' : 'Longest';

  if (assets.length === 0) {
    return <Text style={styles.empty}>No media yet. Import a clip, or generate one under Video.</Text>;
  }

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <View style={styles.findRow}>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search media"
          placeholderTextColor={theme.textWeaker}
          accessibilityLabel="Search media by name"
          style={styles.search}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Sort media: ${sortLabel}. Tap to change`}
          onPress={() => setSort(MEDIA_LIBRARY_SORTS[(MEDIA_LIBRARY_SORTS.indexOf(sort) + 1) % MEDIA_LIBRARY_SORTS.length] ?? 'project')}
          style={press(styles.sort)}
        >
          <Text style={styles.sortText}>{sortLabel} ▾</Text>
        </Pressable>
      </View>
      {visibleAssets.length === 0 && <Text style={styles.empty}>No media matches “{query.trim()}”.</Text>}
      {visibleAssets.map((asset) => {
        const used = usage[asset.id] ?? 0;
        return (
          <View key={asset.id} style={styles.row}>
            <View style={styles.info}>
              <Text style={styles.name} numberOfLines={1}>
                {asset.displayName}
              </Text>
              <Text style={styles.meta}>
                {(asset.durationMs / 1000).toFixed(1)}s · {formatBytes(assetByteLength(projectId, asset))} ·{' '}
                {used === 0 ? 'not on the timeline' : `${used} clip${used === 1 ? '' : 's'}`}
              </Text>
            </View>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Add ${asset.displayName} to the timeline`}
              onPress={() => onAdd(asset.id)}
              style={press(styles.action)}
            >
              <Text style={styles.actionText}>+ Add</Text>
            </Pressable>

            {/* Deleting removes the file, so it asks — and says what goes with
                it, because the clips on the timeline go too. */}
            {confirming === asset.id ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Confirm deleting ${asset.displayName}`}
                onPress={() => {
                  setConfirming(null);
                  onDelete(asset.id);
                }}
                style={press([styles.action, styles.danger])}
              >
                <Text style={styles.dangerText}>{used > 0 ? `Delete + ${used}` : 'Delete'}</Text>
              </Pressable>
            ) : (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Delete ${asset.displayName}`}
                onPress={() => setConfirming(asset.id)}
                style={press(styles.action)}
              >
                <Text style={styles.actionText}>✕</Text>
              </Pressable>
            )}
          </View>
        );
      })}
      {confirming !== null && (
        <Text style={styles.warn}>
          Deleting removes the file from the project and every clip that used it. It cannot be undone.
        </Text>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { maxHeight: 220 },
  content: { paddingHorizontal: 16, paddingBottom: 10, gap: 8 },
  findRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 },
  search: { flex: 1, minHeight: MIN_TAP, paddingHorizontal: 12, borderWidth: 1, borderColor: theme.line, borderRadius: 8, color: theme.text, fontSize: 14 },
  sort: { minHeight: MIN_TAP, justifyContent: 'center', paddingHorizontal: 10, borderWidth: 1, borderColor: theme.line, borderRadius: 8 },
  sortText: { color: theme.textWeak, fontSize: 13, fontWeight: '600' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: theme.line },
  info: { flex: 1 },
  name: { color: theme.text, fontSize: 14, fontWeight: '600' },
  meta: { color: theme.textWeaker, fontSize: 12, marginTop: 3, fontVariant: ['tabular-nums'] },
  action: { minHeight: MIN_TAP, justifyContent: 'center', paddingHorizontal: 12, borderRadius: 8, borderWidth: 1, borderColor: theme.line },
  actionText: { color: theme.textWeak, fontSize: 13, fontWeight: '700' },
  danger: { borderColor: theme.danger },
  dangerText: { color: theme.danger, fontSize: 13, fontWeight: '700' },
  warn: { color: theme.warn, fontSize: 12, lineHeight: 17 },
  empty: { color: theme.textWeak, fontSize: 13, lineHeight: 19, paddingHorizontal: 16, paddingBottom: 10 }
});
