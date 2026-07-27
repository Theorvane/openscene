import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

const SHORTCUT_HOOK_SOURCE_URL = new URL('../src/renderer/src/editor/useTimelineShortcuts.ts', import.meta.url);
const TIMELINE_EDITOR_SOURCE_URL = new URL('../src/renderer/src/editor/TimelineEditor.tsx', import.meta.url);
const NATIVE_MENU_SOURCE_URL = new URL('../src/renderer/src/editor/useEditorNativeMenuCommands.ts', import.meta.url);

describe('agent workspace keyboard lock contract', () => {
  it('does not let TimelineEditor own the attach control while agent busy-locking remains active', async () => {
    const [shortcutHook, timelineEditor, nativeMenu] = await Promise.all([
      readFile(SHORTCUT_HOOK_SOURCE_URL, 'utf8'),
      readFile(TIMELINE_EDITOR_SOURCE_URL, 'utf8'),
      readFile(NATIVE_MENU_SOURCE_URL, 'utf8')
    ]);

    expect(shortcutHook).toContain('readonly isLocked: boolean;');
    expect(shortcutHook).toContain('if (input.isLocked) return;');
    expect(timelineEditor).toContain("import { useAgentChat } from '../AgentChatContext';");
    expect(timelineEditor).toContain('const { isBusy: isAgentBusy } = useAgentChat();');
    expect(timelineEditor).toContain('isLocked: isAgentBusy,');
    expect(timelineEditor).toContain('isAgentBusy,');
    expect(timelineEditor).not.toContain('Add selected asset to Edit Agent');
    expect(timelineEditor).not.toContain('attachContextAsset(');
    expect(nativeMenu).toContain('readonly isAgentBusy: boolean;');
    expect(nativeMenu).toContain('isBusy: editor.isBusy || input.isAgentBusy,');
  });
});
