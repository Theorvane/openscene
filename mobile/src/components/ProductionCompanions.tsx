import { Pressable, Text, View } from 'react-native';
import { productionCompanions } from '@openvideo/shared/productionCompanions';
import type { MobileProject } from '../lib/projectStore';
import { theme } from '../lib/theme';
import { MIN_TAP, press } from '../lib/touch';

export function ProductionCompanions({ project, disabled, onSelect }: {
  project: MobileProject; disabled: boolean; onSelect: (tool: 'image' | 'voice') => void;
}) {
  const status = productionCompanions(project.ai, project.assets, project.timeline);
  const text = { color: theme.text, fontSize: 13 };
  const action = (label: string, tool: 'image' | 'voice') => <Pressable accessibilityRole="button" disabled={disabled} onPress={() => onSelect(tool)} style={press({ minHeight: MIN_TAP, padding: 12, borderWidth: 1, borderColor: theme.line, borderRadius: 8 })}><Text style={text}>{label}</Text></Pressable>;
  return <View style={{ padding: 12, gap: 10, borderWidth: 1, borderColor: theme.line, borderRadius: 12 }}>
    <Text style={{ ...text, fontWeight: '600' }}>Build the rest of your film</Text>
    <Text style={text}>{status.frames}/{status.shots} planned shots have a saved first frame. Reference-driven batch generation requires desktop; mobile will not silently discard references.</Text>
    {action('Open reference image tool', 'image')}
    <Text style={text}>{status.voiceMessage}</Text>
    <Text style={text}>{status.audioAssets} saved audio assets · {status.placedAudioAssets} placed. Placement alone does not confirm synchronization.</Text>
    {action('Prepare voice & captions', 'voice')}
    <Text style={text}>Mobile can prepare and apply captions. Speech synthesis is unavailable until audio result transport is implemented; use desktop to synthesize. Opening a tool does not charge a provider.</Text>
  </View>;
}
