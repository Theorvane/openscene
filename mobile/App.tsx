import type { ComponentType } from 'react';
import { useEffect, useState } from 'react';
import { AppState, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { timelineDurationMs } from '@openvideo/shared/timelineLogic';
import { AgentScreen } from './src/screens/AgentScreen';
import { EditScreen } from './src/screens/EditScreen';
import { ImageScreen } from './src/screens/ImageScreen';
import { LibraryScreen } from './src/screens/LibraryScreen';
import { AdBanner } from './src/components/AdBanner';
import { PlanScreen } from './src/screens/PlanScreen';
import { ProjectsScreen } from './src/screens/ProjectsScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';
import { VoiceScreen } from './src/screens/VoiceScreen';
import { WriterScreen } from './src/screens/WriterScreen';
import { assetUri, readProject } from './src/lib/projectStore';
import { useProject } from './src/lib/useProject';
import { exportReviewSummary } from '@openvideo/shared/exportReview';
import { deliverExport, exportTimeline } from './src/lib/exportComposition';
import { prepareExportAd, showExportAd } from './src/lib/exportAd';
import { track } from './src/lib/analyticsClient';
import { isExportAvailable } from './modules/video-export';
import {
  ChevronLeftIcon,
  ClapperIcon,
  GearIcon,
  PictureIcon,
  PencilIcon,
  SparkIcon,
  StackIcon,
  TimelineIcon,
  WaveIcon
} from './src/components/Icon';
import { theme } from './src/lib/theme';
import { MIN_TAP, press } from './src/lib/touch';

/**
 * Two levels. The project list is the root; opening a project enters a container
 * that owns its own tabs.
 *
 * The tabs live inside the project rather than beside it. A flat bar would put
 * Projects at the same level as Voice, which is not true — but hiding the same
 * entries behind a sheet made the user open something to find out what was in
 * it. Inside the project they are all visible and one tap away, and the
 * hierarchy still holds.
 */
const PROJECT_TABS = [
  { id: 'edit', label: 'Edit', Icon: TimelineIcon },
  { id: 'writer', label: 'Writer', Icon: PencilIcon },
  { id: 'video', label: 'Video', Icon: ClapperIcon },
  { id: 'voice', label: 'Voice', Icon: WaveIcon },
  { id: 'image', label: 'Image', Icon: PictureIcon },
  { id: 'agent', label: 'AI', Icon: SparkIcon },
  // Last, because it is where things end up rather than where work starts.
  { id: 'library', label: 'Library', Icon: StackIcon }
] as const satisfies readonly { id: string; label: string; Icon: ComponentType<{ size?: number; color?: string }> }[];

type ProjectTab = (typeof PROJECT_TABS)[number]['id'];
type Route = { readonly name: 'projects' } | { readonly name: 'project'; readonly projectId: string };
type ExportState =
  | { kind: 'idle' }
  | { kind: 'running' }
  /**
   * `wrong` is what the finished file measures when it does not match the cut.
   * The file did save, so this is not a failure — but it is not the quiet
   * "Saved" that a truncated or silent export used to get either.
   */
  | { kind: 'done'; where: string; wrong?: string }
  | { kind: 'failed'; message: string };

export default function App() {
  return (
    // Required by the gesture handler on Android: without it the timeline's
    // gestures never reach the handler and the editor is back to guessing.
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        <Shell />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

function Shell() {
  const insets = useSafeAreaInsets();
  const [route, setRoute] = useState<Route>({ name: 'projects' });
  const [tab, setTab] = useState<ProjectTab>('edit');
  const [settingsOpen, setSettingsOpen] = useState(false);
  /**
   * Bumped when Settings closes.
   *
   * Settings is a modal, so the screen underneath never unmounts and never
   * re-reads the keystore — connecting a provider there left the picker still
   * saying "not connected" until the tab was changed and changed back.
   */
  const [connectionsVersion, setConnectionsVersion] = useState(0);
  const closeSettings = (): void => {
    setSettingsOpen(false);
    setConnectionsVersion((version) => version + 1);
  };
  const [exportState, setExportState] = useState<ExportState>({ kind: 'idle' });

  /*
    One event for each foreground session and one when that session ends.

    Mobile platforms do not offer a reliable callback for force-quit or process
    termination. Leaving `active` is the durable boundary instead: it records
    the session when the app backgrounds, then opening it again starts a new
    one. The duration is rounded by the analytics sanitiser before it leaves the
    device.
  */
  useEffect(() => {
    let activeSince = Date.now();
    let previous = AppState.currentState;
    track('app_opened');

    const subscription = AppState.addEventListener('change', (next) => {
      if (previous === 'active' && next !== 'active') {
        track('app_closed', { sessionSeconds: (Date.now() - activeSince) / 1_000 });
      } else if (previous !== 'active' && next === 'active') {
        activeSince = Date.now();
        track('app_opened');
      }
      previous = next;
    });

    return () => subscription.remove();
  }, []);
  /**
   * Where the tab body starts, measured rather than assumed.
   *
   * KeyboardAvoidingView compares its own `onLayout` box — which is relative to
   * its parent — against a keyboard position in screen coordinates, so a screen
   * that does not start at the top of the display has to be told how far down it
   * begins or it lifts its content that much too little. The title bar's height
   * is not a constant: it carries the top inset, and it grows by a row whenever
   * an export result is showing.
   */
  const [bodyTop, setBodyTop] = useState(0);
  /*
    Above the early return, because it is a hook.

    Reading the project used to be a plain function call, so it sat where it was
    needed — after the branch that renders the project list. Subscribing made it
    a hook, and a hook that only runs on one of two routes changes the hook count
    between renders: opening a project crashed the app outright with "rendered
    more hooks than during the previous render". A null id is the projects route,
    where there is no project to read.
  */
  const project = useProject(route.name === 'project' ? route.projectId : null);

  if (route.name === 'projects') {
    return (
      <View style={styles.root}>
        <StatusBar style="light" />
        <ProjectsScreen
          topInset={insets.top}
          activeProjectId={null}
          onOpen={(id) => {
            setRoute({ name: 'project', projectId: id });
            setTab('edit');
            setExportState({ kind: 'idle' });
          }}
          onOpenSettings={() => setSettingsOpen(true)}
        />
        <SettingsModal open={settingsOpen} onClose={() => closeSettings()} topInset={insets.top} bottomInset={insets.bottom} />
      </View>
    );
  }

  // Subscribed rather than merely read: the import happens in the editor below,
  // so nothing here re-rendered and Export stayed disabled over a ten-second
  // timeline until the user changed tabs and came back.
  const pictureSeconds = project === null ? 0 : timelineDurationMs(project.timeline) / 1000;

  /**
   * Reads the project from disk rather than from the editor's state. Every
   * accepted edit already writes, so the stored copy is current — and it keeps
   * export out of the editing toolbar, where it sat among tools that change a
   * clip rather than produce the whole video.
   */
  const runExport = async (): Promise<void> => {
    const current = readProject(route.projectId);
    if (current === null) return;
    setExportState({ kind: 'running' });
    // Counts and a duration, never what was in the cut. `clips` is every clip on
    // the timeline rather than the number of distinct sources behind them: the
    // question it answers is how big a cut people export, and one clip used
    // four times is four pieces of work.
    track('export_started', { seconds: pictureSeconds, clips: current.timeline.tracks.reduce((n, t) => n + t.clips.length, 0) });
    const startedAt = Date.now();
    // Requested while the encoder runs, because that wait is the only window
    // there is: an interstitial asked for at the moment it is shown either makes
    // the user wait again or shows nothing.
    prepareExportAd();
    const rendered = await exportTimeline({
      timeline: current.timeline,
      // The project's own choice, and absent means the footage decides — a cut
      // of one upright clip comes out upright rather than pillarboxed inside a
      // landscape frame, which is what this used to do to every phone video.
      ...(current.frame === undefined ? {} : { frame: current.frame }),
      assets: current.assets.map((asset) => ({
        id: asset.id,
        uri: assetUri(current.id, asset),
        displayName: asset.displayName,
        kind: asset.kind,
        mimeType: asset.mimeType,
        byteLength: 0,
        projectRelativePath: asset.relativePath,
        createdAt: current.createdAt,
        updatedAt: current.updatedAt,
        metadata: { durationMs: asset.durationMs, width: asset.width, height: asset.height }
      }))
    });
    if (!rendered.ok) {
      setExportState({ kind: 'failed', message: rendered.message });
      // No message: a failure reason is written for the person reading it and
      // can name a file or a path.
      track('export_failed', { seconds: pictureSeconds });
      void showExportAd(false);
      return;
    }
    const delivery = await deliverExport(rendered.uri);
    // What the file itself measures. Only a mismatch is said out loud: an
    // export nobody could measure, on a build without the reader, is not a
    // finding to put in front of someone.
    const wrong =
      rendered.review.checked && !rendered.review.ok ? exportReviewSummary(rendered.review) : undefined;
    setExportState(
      delivery.ok
        ? {
            kind: 'done',
            where: delivery.how === 'photos' ? 'your photo library' : 'the app you chose',
            ...(wrong === undefined ? {} : { wrong })
          }
        : { kind: 'failed', message: delivery.message }
    );
    /*
      After the result is on screen, and only if there is one.

      Before the export would be an ad in front of an action the user just
      asked for, arriving under a thumb still travelling toward the button they
      pressed; during it would be an ad over a progress state. Both are what
      the mediated networks' interstitial policies are written about. Finishing
      is the one genuine break this app has.

      A failed export still calls this — with `false`, which shows nothing and
      releases the ad that was loaded for a moment that did not arrive.
    */
    track(delivery.ok ? 'export_finished' : 'export_failed', {
      seconds: pictureSeconds,
      tookMs: Date.now() - startedAt,
      toPhotos: delivery.ok ? delivery.how === 'photos' : null,
      // Whether the file matched the cut, or null where nothing could measure
      // it. A renderer that starts shipping mismatches is worth seeing in the
      // aggregate rather than one bug report at a time.
      matchedCut: rendered.review.checked ? rendered.review.ok : null
    });
    void showExportAd(delivery.ok);
  };

  const canExport = isExportAvailable && pictureSeconds > 0 && exportState.kind !== 'running';

  return (
    <View style={styles.root}>
      <StatusBar style="light" />

      <View style={[styles.bar, { paddingTop: insets.top + 8 }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back to projects"
          onPress={() => setRoute({ name: 'projects' })}
          style={press(styles.barButton)}
        >
          <ChevronLeftIcon size={20} />
        </Pressable>
        <Text style={styles.barTitle} numberOfLines={1}>{project?.name ?? 'Project'}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Export video"
          disabled={!canExport}
          onPress={() => void runExport()}
          style={press([styles.export, !canExport && styles.exportOff])}
        >
          <Text style={styles.exportText}>{exportState.kind === 'running' ? 'Exporting…' : 'Export'}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Settings"
          onPress={() => setSettingsOpen(true)}
          style={press(styles.barButton)}
        >
          <GearIcon size={19} />
        </Pressable>
      </View>

      {/*
        A build without the renderer says so.

        `README-native.md` describes this note — "export is disabled there, with
        the reason shown on screen" — and it was not on screen: the button simply
        dimmed, which is indistinguishable from an empty timeline or an export
        already running, and reads as a bug rather than a limit. AGENTS.md asks
        for the opposite, and the Video tab already does it for frame extraction.
      */}
      {!isExportAvailable && (
        <Text style={styles.limit}>
          Export needs a development build — Expo Go carries only the modules baked into it, and the renderer is this
          project&apos;s own. Everything else on this screen works.
        </Text>
      )}

      {/* A result the user can put away. It used to be a line of text that stayed
          until the next export, so a failure from ten minutes ago still sat under
          the toolbar looking like it had just happened. */}
      {(exportState.kind === 'failed' || exportState.kind === 'done') && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Dismiss export result"
          onPress={() => setExportState({ kind: 'idle' })}
          style={press([
            styles.banner,
            exportState.kind === 'failed' || exportState.wrong !== undefined ? styles.bannerFail : styles.bannerOk
          ])}
        >
          <Text
            style={[
              styles.bannerText,
              (exportState.kind === 'failed' || exportState.wrong !== undefined) && styles.bannerTextFail
            ]}
          >
            {exportState.kind === 'failed'
              ? exportState.message
              : exportState.wrong === undefined
                ? `Saved to ${exportState.where}.`
                : `Saved to ${exportState.where}, but it does not match the cut. ${exportState.wrong}`}
          </Text>
          <Text style={styles.bannerDismiss}>Dismiss</Text>
        </Pressable>
      )}

      <View style={styles.body} onLayout={(event) => setBodyTop(event.nativeEvent.layout.y)}>
        {tab === 'edit' && <EditScreen topInset={0} projectId={route.projectId} />}
        {tab === 'writer' && (
          <WriterScreen topInset={0} keyboardOffset={bodyTop} projectId={route.projectId} connectionsVersion={connectionsVersion} />
        )}
        {tab === 'video' && (
          <PlanScreen topInset={0} keyboardOffset={bodyTop} projectId={route.projectId} connectionsVersion={connectionsVersion} />
        )}
        {tab === 'voice' && (
          <VoiceScreen topInset={0} keyboardOffset={bodyTop} targetSeconds={pictureSeconds} connectionsVersion={connectionsVersion} />
        )}
        {tab === 'image' && (
          <ImageScreen
            topInset={0}
            keyboardOffset={bodyTop}
            projectId={route.projectId}
            connectionsVersion={connectionsVersion}
          />
        )}
        {tab === 'agent' && <AgentScreen topInset={0} keyboardOffset={bodyTop} projectId={route.projectId} />}
        {tab === 'library' && <LibraryScreen topInset={0} keyboardOffset={bodyTop} projectId={route.projectId} />}
      </View>

      {/* Above the bar rather than over the content: it never covers the
          timeline, and the bar keeps its own border between the two. */}
      <AdBanner />

      <View accessibilityRole="tablist" style={[styles.tabBar, { paddingBottom: insets.bottom, height: 60 + insets.bottom }]}>
        {PROJECT_TABS.map(({ id, label, Icon }) => {
          const selected = id === tab;
          return (
            <Pressable
              key={id}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              accessibilityLabel={label}
              onPress={() => setTab(id)}
              style={press(styles.tab)}
            >
              <View style={[styles.tabIcon, selected && styles.tabIconOn]}>
                <Icon size={19} color={selected ? theme.accent : theme.textWeaker} />
              </View>
              <Text style={[styles.tabLabel, selected && styles.tabOn]}>{label}</Text>
            </Pressable>
          );
        })}
      </View>

      <SettingsModal open={settingsOpen} onClose={() => closeSettings()} topInset={insets.top} bottomInset={insets.bottom} />
    </View>
  );
}

function SettingsModal({ open, onClose, topInset, bottomInset }: { open: boolean; onClose: () => void; topInset: number; bottomInset: number }) {
  return (
    <Modal visible={open} animationType="slide" onRequestClose={onClose}>
      <View style={styles.root}>
        <SettingsScreen topInset={topInset} />
        {/* A footer bar, not a floating pill. The pill sat over the last provider
            card, so the one control the user could not reach was whichever one
            happened to be at the bottom of the list. */}
        <View style={[styles.doneBar, { paddingBottom: bottomInset + 12 }]}>
          <Pressable accessibilityRole="button" onPress={onClose} style={press(styles.done)}>
            <Text style={styles.doneText}>Done</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bg },
  bar: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: theme.line },
  barButton: { width: MIN_TAP, height: MIN_TAP, alignItems: 'center', justifyContent: 'center' },
  barTitle: { flex: 1, color: theme.text, fontSize: 17, fontWeight: '700' },
  export: { minHeight: MIN_TAP, justifyContent: 'center', paddingHorizontal: 16, borderRadius: 10, backgroundColor: theme.accent },
  exportOff: { opacity: 0.3 },
  exportText: { color: theme.bg, fontSize: 14, fontWeight: '700' },
  banner: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: MIN_TAP, marginHorizontal: 16, marginTop: 8, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10, borderWidth: 1 },
  bannerOk: { borderColor: theme.mint },
  bannerFail: { borderColor: theme.danger },
  bannerText: { flex: 1, color: theme.mint, fontSize: 13, lineHeight: 18 },
  bannerTextFail: { color: theme.danger },
  bannerDismiss: { color: theme.textWeak, fontSize: 12, fontWeight: '700' },
  limit: { color: theme.warn, fontSize: 12, lineHeight: 17, paddingHorizontal: 16, paddingTop: 8 },
  body: { flex: 1 },
  tabBar: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: theme.line, backgroundColor: theme.surface },
  tab: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 3, paddingTop: 6 },
  // A filled pill behind the selected icon: colour alone is a weak signal at
  // 19pt, and it is the only one for a user who cannot separate the two hues.
  tabIcon: { width: 40, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  tabIconOn: { backgroundColor: `${theme.accent}22` },
  tabLabel: { color: theme.textWeaker, fontSize: 11, fontWeight: '600' },
  tabOn: { color: theme.accent },
  doneBar: { paddingHorizontal: 20, paddingTop: 12, borderTopWidth: 1, borderTopColor: theme.line, backgroundColor: theme.surface },
  done: { minHeight: MIN_TAP, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: theme.accent },
  doneText: { color: theme.bg, fontSize: 15, fontWeight: '700' }
});
