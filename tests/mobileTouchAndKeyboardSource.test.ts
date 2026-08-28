import { readdir, readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

/**
 * The mobile surface's input contract, asserted from source.
 *
 * These are the faults a phone has and a desktop does not: a keyboard that
 * covers the control being used, a target smaller than a fingertip, and an API
 * that exists on one platform only. None of them is caught by the typechecker
 * and none of them shows up on a simulator with a hardware keyboard attached,
 * which is how they survived in the first place.
 */

const MOBILE = new URL('../mobile/', import.meta.url);

async function readSource(relativePath: string): Promise<string> {
  return readFile(new URL(relativePath, MOBILE), 'utf8');
}

/** Every `.tsx` under `mobile/`, so a new screen cannot quietly opt out. */
async function readAllComponents(): Promise<readonly { readonly path: string; readonly body: string }[]> {
  const roots = ['src/screens/', 'src/components/'];
  const files: { path: string; body: string }[] = [];
  for (const root of roots) {
    for (const name of await readdir(new URL(root, MOBILE))) {
      if (!name.endsWith('.tsx')) continue;
      files.push({ path: `${root}${name}`, body: await readSource(`${root}${name}`) });
    }
  }
  files.push({ path: 'App.tsx', body: await readSource('App.tsx') });
  return files;
}

describe('mobile touch and keyboard source contract', () => {
  it('states one minimum target size and one press style', async () => {
    const touch = await readSource('src/lib/touch.ts');

    // 44 is the iOS minimum; Material asks 48. Slop is what reconciles a control
    // drawn smaller with either number.
    expect(touch).toContain('export const MIN_TAP = 44;');
    expect(touch).toContain('export function slopFor(width: number, height: number = width): Insets | undefined {');
    expect(touch).toContain('export function press(style: StyleProp<ViewStyle>)');
  });

  it('keeps the keyboard off every screen that takes typing', async () => {
    const form = await readSource('src/components/FormScreen.tsx');

    expect(form).toContain('<KeyboardAvoidingView');
    // Both platforms, not iOS alone. Leaving Android to `adjustResize` is what
    // the manifest asks for, but edge-to-edge is mandatory from this SDK and an
    // edge-to-edge window is not resized for the keyboard — it is drawn over.
    expect(form).toContain('behavior="padding"');
    expect(form).not.toContain("Platform.OS === 'ios' ? 'padding' : undefined");
    // Without this a tap on the button below a focused field only dismisses the
    // keyboard, which reads as a dead button.
    expect(form).toContain('keyboardShouldPersistTaps="handled"');
    expect(form).toContain('keyboardDismissMode="on-drag"');

    for (const screen of ['PlanScreen', 'ImageScreen', 'VoiceScreen', 'SettingsScreen', 'ProjectsScreen']) {
      const body = await readSource(`src/screens/${screen}.tsx`);
      expect(body, `${screen} must scroll through FormScreen`).toContain('<FormScreen');
      expect(body, `${screen} must not hand-roll a bare ScrollView`).not.toContain('<ScrollView style={styles.root}');
    }

    // The assistant is not a form: its composer is pinned to the bottom and the
    // thread scrolls above it, so it avoids the keyboard itself.
    const agent = await readSource('src/screens/AgentScreen.tsx');
    expect(agent).toContain('<KeyboardAvoidingView');
    expect(agent).toContain('behavior="padding"');
    expect(agent).toContain('keyboardDismissMode="interactive"');
  });

  it('reveals the focused field, not just the scroll area around it', async () => {
    // Avoiding is not revealing. Shrinking the scrolling area does nothing for a
    // field the user scrolled down to reach, and the provider list is long
    // enough that most of them are. Android used to scroll the focused input
    // into view itself under `adjustResize`; edge-to-edge stopped that too.
    const aware = await readSource('src/components/KeyboardAwareScroll.tsx');

    expect(aware).toContain('measureInWindow');
    // Against the live keyboard frame, not a guessed height: keyboards differ by
    // locale and by whether the suggestion strip is up.
    expect(aware).toContain('Keyboard.metrics()');
    // Twice, because the keyboard sliding up and the avoiding view shrinking are
    // two moving parts, and measuring on the first under-scrolls by the rest.
    expect(aware).toContain('const liftTwice');
    expect(aware).toContain('setTimeout(lift, SETTLE_MS)');

    // Every field the user can type a key or a prompt into asks to be revealed.
    for (const path of [
      'src/components/ProviderConnect.tsx',
      'src/components/AddCustomProvider.tsx',
      'src/screens/PlanScreen.tsx',
      'src/screens/ImageScreen.tsx',
      'src/screens/VoiceScreen.tsx'
    ]) {
      const body = await readSource(path);
      expect(body, `${path} must reveal its focused field`).toContain('useRevealOnFocus()');
      expect(body, `${path} must hand the ref to reveal`).toMatch(/onFocus=\{\(\) => reveal\(\w+\.current\)\}/);
    }

    // Both scroll containers that hold a field provide it.
    expect(await readSource('src/components/FormScreen.tsx')).toContain('<KeyboardAwareScroll');
    expect(await readSource('src/components/ModelSelect.tsx')).toContain('<KeyboardAwareScroll');
  });

  it('abandons a turn whose conversation was ended while it was in flight', async () => {
    // A turn takes seconds against a provider and holds the history it started
    // from, so a reply landing after New put the whole discarded transcript back
    // — and the write effect saved it again.
    const agent = await readSource('src/screens/AgentScreen.tsx');

    expect(agent).toContain('const era = useRef(0);');
    expect(agent).toContain('const started = era.current;');
    expect(agent).toContain('if (started !== era.current) return;');
    // Ending a conversation and moving to another project both invalidate it.
    expect(agent).toMatch(/era\.current \+= 1;[\s\S]{0,80}clearChat\(projectId\);/);
    expect(agent).toMatch(/era\.current \+= 1;[\s\S]{0,80}setMessages\(readChat\(projectId\)\);/);
  });

  it('trims the history it sends, not only the copy it saves', async () => {
    // The cap is justified by "every turn re-sends all of it", and that is the
    // request — trimming only on the way to disk left the cost uncapped until
    // the app was next launched.
    const agent = await readSource('src/screens/AgentScreen.tsx');
    expect(agent).toContain('...trimHistory(dropUnansweredCalls(history))');
  });

  it('keeps a generated image on the message that produced it', async () => {
    // A list beside the thread put every image after everything else, and
    // restoring a conversation brought the words back without the pictures.
    const agent = await readSource('src/screens/AgentScreen.tsx');

    expect(agent).not.toContain('setImages');
    expect(agent).toContain('message.image !== undefined');
    expect(agent).toContain('message.imageDropped === true');
  });

  it('will not let a message be typed past a tool call still waiting', async () => {
    // The approval card for a free tool is inline, not a modal, so nothing
    // physically stopped the user typing past it — and a turn carrying an
    // unanswered call is rejected outright, in-session, with no restart needed
    // for the repair on read to help.
    const agent = await readSource('src/screens/AgentScreen.tsx');

    expect(agent).toContain('if (pending !== null) return;');
    expect(agent).toContain('disabled={thinking || pending !== null || draft.trim().length === 0}');
    // And the outgoing history is repaired the same way the stored one is.
    expect(agent).toContain('...trimHistory(dropUnansweredCalls(history))');
  });

  it('treats backing out of a price prompt as a dismissal, not a refusal', async () => {
    // `onRequestClose` fires on the Android back button, and it was wired to
    // `onDecide('reject')` — which is remembered. One back press turned the
    // feature off for good, silently, undoable only from Settings.
    const prompt = await readSource('src/components/SpendPrompt.tsx');
    expect(prompt).toContain('onRequestClose={onDismiss}');
    expect(prompt).not.toContain("onRequestClose={() => onDecide('reject')}");

    // Every caller has to say what backing out means for it.
    for (const path of ['src/screens/AgentScreen.tsx', 'src/screens/ImageScreen.tsx', 'src/screens/PlanScreen.tsx']) {
      expect(await readSource(path), `${path} must handle dismissal`).toContain('onDismiss=');
    }
    // The agent still answers the call it left hanging, without recording a
    // standing choice for it.
    const agent = await readSource('src/screens/AgentScreen.tsx');
    expect(agent).toContain('const dismiss = (): void => {');
    expect(agent).toContain('dismissed this without deciding');
  });

  it('keeps what the project made, and gives it somewhere to be seen', async () => {
    // A generated shot went straight onto the timeline and a generated still
    // went nowhere at all, so nothing answered "what have I made?".
    const store = await readSource('src/lib/projectStore.ts');
    expect(store).toContain('export function saveGeneratedImage(');
    // A still is placeable now — on a video track, held rather than played —
    // and the rule for that lives in the shared core.
    expect(store).toContain('export function isStillAsset(');

    // Both things that make a still keep it.
    expect(await readSource('src/screens/ImageScreen.tsx')).toContain('saveGeneratedImage(');
    expect(await readSource('src/lib/agentTools.ts')).toContain('saveGeneratedImage(');

    // And it has a home of its own rather than a toggle inside the editor.
    const app = await readSource('App.tsx');
    expect(app).toContain("{ id: 'library', label: 'Library', Icon: StackIcon }");
    expect(app).toContain('<LibraryScreen');

    const library = await readSource('src/screens/LibraryScreen.tsx');
    expect(library).toContain('appendAssetToTimeline');
    expect(library).toContain('deleteAsset');
    // A still is placed like anything else now, and the note says what it did
    // — a hold the user is expected to trim rather than a length it claims.
    expect(library).toContain('STILL_DEFAULT_HOLD_MS');
    expect(library).not.toContain('Stills have no track to sit on');
  });

  it('places an asset it already holds without recording it twice', async () => {
    // The library places assets that are certainly already in the project, and
    // appending unconditionally put two records under one id: React reported
    // "two children with the same key" and the duplicate went to disk.
    const store = await readSource('src/lib/projectStore.ts');

    expect(store).toContain('const known = project.assets.some((entry) => entry.id === asset.id);');
    expect(store).toContain('assets: known ? project.assets : [...project.assets, asset],');
    // Clip ids are unique per placement, as the editor's own placements are —
    // the editor selects, splits, trims and deletes by that id.
    expect(store).toContain('id: `clip-${asset.id}-${Date.now().toString(36)}`');
    expect(store).not.toContain('id: `clip-${asset.id}`');
    // And a project already holding the duplicate is repaired when it is read.
    expect(store).toContain('function dedupeAssets(');
    expect(store).toContain('assets: dedupeAssets(');
  });

  it('places a still, shows it, and refuses to export one it cannot render', async () => {
    // A still is picture on a video track, held rather than played. The parts
    // that differ from a clip are all downstream of that.
    const store = await readSource('src/lib/projectStore.ts');
    expect(store).toContain('stillClipSource()');
    expect(store).not.toContain('if (!isPlaceable(asset)) return null;');

    // The player has nothing to open, so it never sees one.
    const preview = await readSource('src/components/PreviewPlayer.tsx');
    expect(preview).toContain('const source = still === true ? null : uri;');
    // And playback has to cross it, since no decoder reports progress over one.
    const edit = await readSource('src/screens/EditScreen.tsx');
    expect(edit).toContain("const heldFrame = visible === null || visibleAsset?.kind === 'image';");

    // Exporting a still through a renderer that cannot hold one would drop it to
    // a single frame, so it is refused with the reason instead. The rule now
    // lives in the shared preflight, asked before the render rather than after
    // the plan is built — what this pins is that this surface still asks it,
    // with what this build actually reports it can do.
    const composition = await readSource('src/lib/exportComposition.ts');
    expect(composition).toContain('preflightExport({');
    expect(composition).toContain('stills: areStillsRenderable');
    expect(await readSource('modules/video-export/index.ts')).toContain('export const areStillsRenderable');
  });

  it('states the reason export is unavailable rather than dimming in silence', async () => {
    // README-native.md describes this note — "export is disabled there, with the
    // reason shown on screen" — and it was not on screen. A dimmed button is
    // indistinguishable from an empty timeline or a run already going, and
    // AGENTS.md asks for a stated limit rather than a silent one.
    const app = await readSource('App.tsx');

    expect(app).toContain('{!isExportAvailable && (');
    expect(app).toContain('Export needs a development build');
    // The tab bar is a list of tabs, and said so on the tabs but not the bar.
    expect(app).toContain('accessibilityRole="tablist"');
  });

  it('tells each screen how far down the display it starts', async () => {
    // KeyboardAvoidingView measures itself with onLayout, which is relative to
    // its parent, and compares that against a keyboard position in screen
    // coordinates. A screen below a title bar is lifted short by exactly the
    // height of that bar — far enough to look fixed and still cover the button.
    const form = await readSource('src/components/FormScreen.tsx');
    expect(form).toContain('keyboardVerticalOffset={keyboardOffset}');

    const app = await readSource('App.tsx');
    // Measured, not assumed: the bar carries the top inset and grows a row
    // whenever an export result is showing.
    expect(app).toContain('onLayout={(event) => setBodyTop(event.nativeEvent.layout.y)}');
    for (const screen of ['PlanScreen', 'VoiceScreen', 'ImageScreen', 'AgentScreen']) {
      expect(app, `${screen} must be told where the body starts`).toMatch(
        new RegExp(`<${screen}[^>]*keyboardOffset=\\{bodyTop\\}`, 's')
      );
    }

    const agent = await readSource('src/screens/AgentScreen.tsx');
    expect(agent).toContain('keyboardVerticalOffset={keyboardOffset}');
  });

  it('avoids the keyboard inside the sheets that take typing', async () => {
    // A Modal is its own window, so the calling screen's avoidance does not
    // reach inside it. Both of these hold a field: the rename sheet is centred
    // where the keyboard lands, and the provider sheet sits on the bottom edge.
    for (const path of ['src/screens/ProjectsScreen.tsx', 'src/components/ModelSelect.tsx']) {
      const body = await readSource(path);
      expect(body, `${path} must avoid the keyboard inside its Modal`).toContain(
        '<KeyboardAvoidingView style={styles.scrim} behavior="padding">'
      );
    }
  });

  it('renames a project without an iOS-only API', async () => {
    const projects = await readSource('src/screens/ProjectsScreen.tsx');

    // `Alert.prompt` does not exist on Android, and the optional call it was
    // made through turned that into silence rather than an error.
    expect(projects).not.toContain('Alert.prompt?.(');
    expect(projects).not.toContain('Alert.prompt(');
    expect(projects).toContain('setRenaming({ project, name: project.name })');
    expect(projects).toContain('const commitRename = (): void => {');
    // Deleting still uses Alert, which is on both platforms.
    expect(projects).toContain("Alert.alert('Delete project'");
  });

  it('draws the tab bar rather than typesetting it', async () => {
    const app = await readSource('App.tsx');

    // Glyphs render as whatever font the system picks — two of the five were in
    // the emoji range on Android, which ignores the selected-tab colour.
    for (const glyph of ['▤', '◫', '◍', '◈', '✦']) {
      expect(app, `tab glyph ${glyph} must be a drawn icon`).not.toContain(glyph);
    }
    expect(app).toContain('Icon: TimelineIcon');
    expect(app).toContain('Icon: SparkIcon');
    // Colour alone is a weak signal at 19pt, and no signal at all to a user who
    // cannot separate the two hues.
    expect(app).toContain('tabIconOn');
  });

  it('scrubs to the moment under the finger, including on a tick label', async () => {
    // The lane's Pressable turns `locationX` into a time. On Android that is
    // measured from the view which actually received the touch, so while the
    // ruler's ticks were touchable a tap on one reported a position relative to
    // that tick — a fraction of a second — rather than to the lane. Taps between
    // the labels were always right, which is what made it read as flaky.
    const ruler = await readSource('src/components/TimelineRuler.tsx');
    const tickLines = ruler.split('\n').filter((line) => line.includes('styles.tick') || line.includes('styles.half'));

    expect(tickLines.length).toBeGreaterThan(0);
    for (const line of tickLines) {
      expect(ruler, `a ruler tick must not take touches: ${line.trim()}`).toContain('pointerEvents="none"');
    }
    // Not on the root: the root shares its origin with the lane, so leaving it
    // as the touch target is what makes the reported position correct.
    expect(ruler).not.toContain('<View pointerEvents="none" style={[styles.root');
  });

  it('resolves no optional native module at import time', async () => {
    // `expo-media-library` resolves `ExpoMediaLibraryNext`, which a client built
    // without it cannot provide. A top-level import threw while the module graph
    // was still loading, so the app died on a red screen before any screen
    // mounted — not the failed save the fallback below it was written for.
    // `modules/video-export` already guards against exactly this.
    const composition = await readSource('src/lib/exportComposition.ts');

    expect(composition).not.toMatch(/^import .*from 'expo-media-library';$/m);
    expect(composition).toContain('function loadMediaLibrary()');
    expect(composition).toContain('const mediaLibrary = loadMediaLibrary();');

    const videoExport = await readSource('modules/video-export/index.ts');
    expect(videoExport).toContain('requireOptionalNativeModule');
  });

  it('leaves no interactive text below 11pt anywhere on the surface', async () => {
    const files = await readAllComponents();

    for (const { path, body } of files) {
      const tooSmall = [...body.matchAll(/fontSize: (\d+(?:\.\d+)?)/g)]
        .map((match) => Number(match[1]))
        .filter((size) => size < 11);
      expect(tooSmall, `${path} sets font sizes below 11pt: ${tooSmall.join(', ')}`).toEqual([]);
    }
  });

  it('acknowledges a press everywhere a press does something', async () => {
    const files = await readAllComponents();

    for (const { path, body } of files) {
      if (!body.includes('<Pressable')) continue;
      expect(body, `${path} has Pressables but no press feedback`).toContain('press(');
    }
  });
});
