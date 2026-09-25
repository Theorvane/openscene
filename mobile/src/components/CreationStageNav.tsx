import { Pressable, StyleSheet, Text, View } from 'react-native';
import { CREATION_STAGES, SCENE_TOOLS, creationStageForTool, creationStudioStatus } from '@openvideo/shared/creationStudio';
import type { CreationTool } from '@openvideo/shared/workspaceModes';
import type { AiProjectDocument } from '@openvideo/shared/aiProjectDomain';
import type { ProductionEditorAsset } from '@openvideo/shared/productionEditor';
import { theme } from '../lib/theme';
import { MIN_TAP, press } from '../lib/touch';

export function CreationStageNav({ tool, onSelect, document, assets }: { tool: CreationTool; onSelect: (tool: CreationTool) => void; document: AiProjectDocument | null | undefined; assets: readonly ProductionEditorAsset[] }) {
  const stage = creationStageForTool(tool);
  return <View style={styles.container}>
    <Text style={styles.title}>Production studio</Text>
    <View style={styles.row}>{CREATION_STAGES.map(entry => <Pressable key={entry.id} accessibilityRole="button" accessibilityState={{ selected: stage.id === entry.id }}
      style={press([styles.button, stage.id === entry.id && styles.selected])} onPress={() => onSelect(stage.id === entry.id ? tool : entry.tool)}><Text style={styles.text}>{entry.label}</Text></Pressable>)}</View>
    {stage.id === 'scenes' && <View style={styles.row}>{SCENE_TOOLS.map(entry => <Pressable key={entry.id} accessibilityRole="button" accessibilityState={{ selected: tool === entry.id }}
      style={press([styles.button, tool === entry.id && styles.selected])} onPress={() => onSelect(entry.id)}><Text style={styles.text}>{entry.label}</Text></Pressable>)}</View>}
    <Text style={styles.title}>{creationStudioStatus(document, assets)[stage.id]}</Text>
  </View>;
}
const styles = StyleSheet.create({
  container: { paddingHorizontal: 12, paddingBottom: 8, gap: 6 }, title: { color: theme.textWeak, fontSize: 12 },
  row: { flexDirection: 'row', gap: 6 }, button: { flex: 1, minHeight: MIN_TAP, alignItems: 'center', justifyContent: 'center', padding: 6, borderWidth: 1, borderColor: theme.line, borderRadius: 8 },
  selected: { borderColor: theme.accent }, text: { color: theme.text, fontSize: 12 }
});
