import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';
import type { AiProjectDocument } from '@openvideo/shared/aiProjectDomain';
import type { TimelineDocument } from '@openvideo/shared/timelineTypes';
import { PRODUCTION_LANES, inspectProductionTime, productionPlanDuration, productionReadiness, productionEditorItems, type ProductionEditorItem } from '@openvideo/shared/productionEditor';
import { assetUri, type MobileAsset } from '../lib/projectStore';
import { theme } from '../lib/theme';
import { MIN_TAP, press } from '../lib/touch';
import { productionTimeLabel } from '@openvideo/shared/productionDisplay';

function Preview({ projectId, asset, active, offsetMs }: { projectId: string; asset: MobileAsset; active: boolean; offsetMs: number }) {
  const player = useVideoPlayer(assetUri(projectId, asset));
  useEffect(() => { if (!active) player.pause(); }, [active, player]);
  useEffect(() => {
    const seek = () => {
      if (player.status !== 'readyToPlay') return false;
      player.pause(); player.currentTime = Math.min(offsetMs / 1000, Math.max(0, player.duration - .001));
      return true;
    };
    if (seek()) return;
    const listener = player.addListener('statusChange', () => { if (seek()) listener.remove(); });
    return () => listener.remove();
  }, [player, offsetMs]);
  return <VideoView player={player} nativeControls contentFit="contain" style={styles.preview} />;
}
export function ProductionNavigator({ projectId, document, assets, timeline, active, busy, onLoad, onPlaceVoice }: {
  projectId: string; document: AiProjectDocument; assets: readonly MobileAsset[]; active: boolean; busy: boolean;
  onLoad: (item: ProductionEditorItem) => void;
  timeline: TimelineDocument; onPlaceVoice: (assetId: string) => void;
}) {
  const [selectedId, setSelectedId] = useState('');
  const [showProperties, setShowProperties] = useState(true);
  const [inspectionMs, setInspectionMs] = useState<number | null>(null);
  const items = productionEditorItems(document, assets, timeline);
  const inspection = inspectProductionTime(items, inspectionMs ?? 0);
  const selected = inspectionMs === null ? items.find(item => item.id === selectedId) ?? items[0] : inspection.video;
  const durationMs = productionPlanDuration(items);
  const readiness = productionReadiness(items);
  const asset = assets.find(item => item.id === selected?.assetId);
  return <View style={styles.card}>
    <View style={styles.timeControls}><Text style={styles.title}>SOURCE MONITOR</Text><Pressable accessibilityRole="button" accessibilityState={{ expanded: showProperties }} onPress={() => setShowProperties(value => !value)} style={press(styles.action)}><Text style={styles.text}>Properties</Text></Pressable></View>
    <Text style={styles.hint}>Single-source preview · {productionTimeLabel(durationMs)}</Text>
    {asset?.kind === 'video' ? <Preview key={projectId + asset.id} projectId={projectId} asset={asset} active={active} offsetMs={inspectionMs === null ? 0 : inspection.sourceOffsetMs} /> : <Text style={styles.hint}>{selected?.lane === 'subtitles' ? selected.prompt : asset?.kind === 'audio' ? 'Audio preview is available in the Voice tool; inline playback is not supported here yet.' : 'Select a saved take below. Shots without media stay visible as planned.'}</Text>}
    <Text style={styles.hint}>{readiness.approved}/{readiness.total} shots approved · {readiness.missing} missing media · {readiness.review} need review</Text>
    {durationMs > 0 && <View style={styles.timeControls}>
      <Pressable accessibilityRole="button" accessibilityLabel="Inspect previous second" onPress={() => setInspectionMs(Math.max(0, inspection.timeMs - 1000))} style={press(styles.action)}><Text style={styles.text}>−1s</Text></Pressable>
      <Text style={styles.timecode}>{productionTimeLabel(inspection.timeMs)}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Inspect next second" onPress={() => setInspectionMs(Math.min(durationMs, inspection.timeMs + 1000))} style={press(styles.action)}><Text style={styles.text}>+1s</Text></Pressable>
    </View>}
    {inspectionMs !== null && <Text style={styles.hint}>Caption at inspected time: {inspection.captions.map(item => item.prompt).join(' ') || 'None'}</Text>}
    {selected && showProperties && <><Text style={styles.title}>{selected.label}</Text><Text style={styles.hint}>{selected.status}</Text>
      {selected.lane === 'voice' && selected.assetId && selected.startMs === undefined && <Pressable accessibilityRole="button" disabled={busy} onPress={() => onPlaceVoice(selected.assetId!)} style={press(styles.action)}><Text style={styles.text}>Append voice and save</Text></Pressable>}
      {(selected.recipeId || selected.shotId) && <Pressable accessibilityRole="button" disabled={busy} onPress={() => onLoad(selected)} style={press(styles.action)}><Text style={styles.text}>Edit selected prompt</Text></Pressable>}
    </>}
    <Text style={styles.title}>SEQUENCE / PLAN</Text>
    {PRODUCTION_LANES.map((lane, index) => <View key={lane}><Text style={styles.title}>{['V1', 'A1', 'T1'][index]}  ·  {lane}</Text>
      <ScrollView horizontal accessibilityLabel={lane + ' track'}>
        {items.filter(item => item.lane === lane).map(item => <Pressable accessibilityRole="button" accessibilityState={{ selected: selected?.id === item.id }} key={item.id}
          onPress={() => { if (item.startMs !== undefined && item.lane !== 'voice') setInspectionMs(item.startMs); else { setInspectionMs(null); setSelectedId(item.id); } }} style={press([styles.item, { borderLeftColor: lane === 'video' ? '#a89af5' : lane === 'voice' ? '#69d5b0' : '#e8bb73' }, selected?.id === item.id && styles.selected])}>
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
  timeControls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  card: { backgroundColor: '#22262e', borderWidth: 1, borderColor: '#363d49', borderRadius: 4, padding: 12, gap: 10 },
  timecode: { color: theme.text, fontVariant: ['tabular-nums'], fontSize: 13 },
  title: { color: theme.text, fontWeight: '600', fontSize: 13 }, text: { color: theme.text, fontSize: 13 },
  hint: { color: theme.textWeak, fontSize: 12, paddingVertical: 4 }, preview: { width: '100%', height: 200, backgroundColor: '#111' },
  item: { backgroundColor: '#292e38', width: 160, minHeight: MIN_TAP, padding: 10, borderWidth: 1, borderLeftWidth: 3, borderColor: '#515d70', borderRadius: 3, marginRight: 6 },
  selected: { borderColor: '#9cbfff', backgroundColor: '#2c4164' }, action: { minHeight: MIN_TAP, justifyContent: 'center', paddingHorizontal: 12, borderWidth: 1, borderColor: '#78a9ff', borderRadius: 4 }
});
