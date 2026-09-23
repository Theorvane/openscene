import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';
import type { AiProjectDocument } from '@openvideo/shared/aiProjectDomain';
import { PRODUCTION_LANES, productionEditorItems, type ProductionEditorItem } from '@openvideo/shared/productionEditor';
import { assetUri, type MobileAsset } from '../lib/projectStore';
import { theme } from '../lib/theme';
import { MIN_TAP, press } from '../lib/touch';

function Preview({ projectId, asset, active }: { projectId: string; asset: MobileAsset; active: boolean }) {
  const player = useVideoPlayer(assetUri(projectId, asset));
  useEffect(() => { if (!active) player.pause(); }, [active, player]);
  return <VideoView player={player} nativeControls contentFit="contain" style={styles.preview} />;
}
export function ProductionNavigator({ projectId, document, assets, active, busy, onLoad }: {
  projectId: string; document: AiProjectDocument; assets: readonly MobileAsset[]; active: boolean; busy: boolean;
  onLoad: (item: ProductionEditorItem) => void;
}) {
  const [selectedId, setSelectedId] = useState('');
  const items = productionEditorItems(document, assets);
  const selected = items.find(item => item.id === selectedId) ?? items[0];
  const asset = assets.find(item => item.id === selected?.assetId);
  return <View style={styles.card}>
    <Text style={styles.title}>Production preview</Text>
    {asset?.kind === 'video' ? <Preview key={projectId + asset.id} projectId={projectId} asset={asset} active={active} /> : <Text style={styles.hint}>{selected?.lane === 'subtitles' ? selected.prompt : asset?.kind === 'audio' ? 'Audio preview is available in the Voice tool; inline playback is not supported here yet.' : 'Select a saved take below. Shots without media stay visible as planned.'}</Text>}
    {selected && <><Text style={styles.title}>{selected.label}</Text><Text style={styles.hint}>{selected.status}</Text>
      {(selected.recipeId || selected.shotId) && <Pressable accessibilityRole="button" disabled={busy} onPress={() => onLoad(selected)} style={press(styles.action)}><Text style={styles.text}>Edit selected prompt</Text></Pressable>}
    </>}
    {PRODUCTION_LANES.map(lane => <View key={lane}><Text style={styles.title}>{lane}</Text>
      <ScrollView horizontal accessibilityLabel={lane + ' track'}>
        {items.filter(item => item.lane === lane).map(item => <Pressable accessibilityRole="button" accessibilityState={{ selected: selected?.id === item.id }} key={item.id}
          onPress={() => setSelectedId(item.id)} style={press([styles.item, selected?.id === item.id && styles.selected])}>
          <Text style={styles.hint}>{item.startMs === undefined ? 'Unplaced' : (item.startMs / 1000).toFixed(1) + 's'}{item.durationMs === undefined ? '' : ' · ' + item.durationMs / 1000 + 's'}</Text>
          <Text numberOfLines={2} style={styles.text}>{item.label}</Text>
        </Pressable>)}
        {!items.some(item => item.lane === lane) && <Text style={styles.hint}>No {lane} yet.</Text>}
      </ScrollView>
    </View>)}
    <Text style={styles.hint}>Plan navigator, not a synchronized final cut. Loading a prompt does not generate. Original media is kept.</Text>
  </View>;
}
const styles = StyleSheet.create({
  card: { borderWidth: 1, borderColor: theme.line, borderRadius: 12, padding: 12, gap: 10 },
  title: { color: theme.text, fontWeight: '600', fontSize: 13 }, text: { color: theme.text, fontSize: 13 },
  hint: { color: theme.textWeak, fontSize: 12, paddingVertical: 4 }, preview: { width: '100%', height: 200, backgroundColor: '#111' },
  item: { width: 160, minHeight: MIN_TAP, padding: 10, borderWidth: 1, borderColor: theme.line, borderRadius: 8, marginRight: 8 },
  selected: { borderColor: theme.accent }, action: { minHeight: MIN_TAP, justifyContent: 'center', paddingHorizontal: 12, borderWidth: 1, borderColor: theme.accent, borderRadius: 8 }
});
