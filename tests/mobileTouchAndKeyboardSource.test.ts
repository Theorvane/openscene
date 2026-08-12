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
