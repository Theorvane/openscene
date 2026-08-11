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
    // Android resizes the window itself; asking for padding as well lifts the
    // content twice.
    expect(form).toContain("behavior={Platform.OS === 'ios' ? 'padding' : undefined}");
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
    expect(agent).toContain("behavior={Platform.OS === 'ios' ? 'padding' : undefined}");
    expect(agent).toContain('keyboardDismissMode="interactive"');
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
