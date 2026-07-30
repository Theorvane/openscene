import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';

import { ImageScreen } from './src/screens/ImageScreen';
import { PlanScreen } from './src/screens/PlanScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';
import { theme } from './src/lib/theme';

/**
 * Bottom tabs rather than the desktop's top strip. The desktop puts its tabs at
 * the top because the window has chrome to hang them from; a phone's reachable
 * area is the bottom, and the thumb is the pointer.
 *
 * Hand-rolled rather than pulling in a navigation library: three sibling screens
 * with no stack, no params, and no deep links do not need one, and the library
 * would be the largest dependency in the app.
 */
const TABS = [
  { id: 'plan', label: 'Plan', glyph: '◫', Screen: PlanScreen },
  { id: 'image', label: 'Image', glyph: '◈', Screen: ImageScreen },
  { id: 'settings', label: 'Settings', glyph: '⚙', Screen: SettingsScreen }
] as const;

type TabId = (typeof TABS)[number]['id'];

export default function App() {
  return (
    <SafeAreaProvider>
      <Shell />
    </SafeAreaProvider>
  );
}

function Shell() {
  const [active, setActive] = useState<TabId>('plan');
  // Hardcoded padding put the title under the Dynamic Island on an iPhone 17
  // Pro and guessed at the home-indicator height. The insets are the only
  // numbers that are right on every device.
  const insets = useSafeAreaInsets();
  const tabBarHeight = 54 + insets.bottom;

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      {/* Every screen stays mounted so switching tabs does not throw away a
          typed prompt or a generated image. */}
      {TABS.map(({ id, Screen }) => (
        <View
          key={id}
          style={[styles.page, { bottom: tabBarHeight }, id !== active && styles.pageHidden]}
          pointerEvents={id === active ? 'auto' : 'none'}
        >
          <Screen topInset={insets.top} />
        </View>
      ))}

      <View style={[styles.tabBar, { height: tabBarHeight, paddingBottom: insets.bottom }]}>
        {TABS.map(({ id, label, glyph }) => {
          const selected = id === active;
          return (
            <Pressable
              key={id}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              accessibilityLabel={label}
              onPress={() => setActive(id)}
              style={styles.tab}
            >
              <Text style={[styles.tabGlyph, selected && styles.tabOn]}>{glyph}</Text>
              <Text style={[styles.tabLabel, selected && styles.tabOn]}>{label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bg },
  page: { position: 'absolute', top: 0, left: 0, right: 0 },
  pageHidden: { opacity: 0, zIndex: -1 },
  tabBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: theme.line,
    backgroundColor: theme.surface
  },
  tab: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 2 },
  tabGlyph: { color: theme.textWeaker, fontSize: 18, lineHeight: 22 },
  tabLabel: { color: theme.textWeaker, fontSize: 10, fontWeight: '600' },
  tabOn: { color: theme.accent }
});
