import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { DEFAULT_MEDIA_LIBRARY_FILTERS, mediaLibraryFiltersActive, mediaLibraryView, MEDIA_LIBRARY_SORTS, type MediaLibraryFilters } from '@openvideo/shared/mediaLibraryView';
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
  filters,
  onFiltersChange,
  onAdd,
  onDelete
}: {
  readonly projectId: string;
  readonly assets: readonly MobileAsset[];
  /** How many clips reference each asset id. */
  readonly usage: ReadonlyMap<string, number>;
  readonly filters: MediaLibraryFilters;
  readonly onFiltersChange: (filters: MediaLibraryFilters) => void;
  readonly onAdd: (assetId: string) => void;
  readonly onDelete: (assetId: string) => void;
}) {
  const [confirming, setConfirming] = useState<string | null>(null);
  const visibleAssets = mediaLibraryView(assets, { ...filters, usage, durationMs: (asset) => asset.durationMs });
  const filtersActive = mediaLibraryFiltersActive(filters);
  const sortLabel = filters.sort === 'project' ? 'Project' : filters.sort === 'name' ? 'Name' : filters.sort === 'type' ? 'Type' : 'Longest';

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <View style={styles.findRow}>
        <TextInput
          value={filters.query}
          onChangeText={(query) => onFiltersChange({ ...filters, query })}
          placeholder="Search media"
          placeholderTextColor={theme.textWeaker}
          accessibilityLabel="Search media by name"
          style={styles.search}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Sort media: ${sortLabel}. Tap to change`}
          onPress={() => onFiltersChange({ ...filters, sort: MEDIA_LIBRARY_SORTS[(MEDIA_LIBRARY_SORTS.indexOf(filters.sort) + 1) % MEDIA_LIBRARY_SORTS.length] ?? 'project' })}
          style={press(styles.sort)}
        >
          <Text style={styles.sortText}>{sortLabel} ▾</Text>
        </Pressable>
      </View>
      <View style={styles.filterRow}>
        <Pressable
          accessibilityRole="checkbox"
          accessibilityState={{ checked: filters.unusedOnly }}
          accessibilityLabel="Unused media only"
          onPress={() => onFiltersChange({ ...filters, unusedOnly: !filters.unusedOnly })}
          style={press(styles.unused)}
        >
          <Text style={styles.sortText}>{filters.unusedOnly ? '☑' : '□'} Unused only</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Reset media filters"
          disabled={!filtersActive}
          onPress={() => onFiltersChange(DEFAULT_MEDIA_LIBRARY_FILTERS)}
          style={press(styles.reset)}
        >
          <Text style={[styles.sortText, !filtersActive && styles.disabled]}>Reset</Text>
        </Pressable>
      </View>
      {assets.length === 0
        ? <Text style={styles.empty}>No media yet. Import a clip, or generate one under Video.</Text>
        : visibleAssets.length === 0 && <Text style={styles.empty}>No media matches the current filters.</Text>}
      {visibleAssets.map((asset) => {
        const used = usage.get(asset.id) ?? 0;
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
  filterRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  unused: { minHeight: MIN_TAP, justifyContent: 'center', alignSelf: 'flex-start', paddingHorizontal: 4 },
  reset: { minHeight: MIN_TAP, justifyContent: 'center', paddingHorizontal: 4 },
  disabled: { opacity: 0.4 },
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
