import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_EXPORT_FRAME,
  EXPORT_FRAME_PREFERENCES,
  parseExportFramePreferences,
  serializeExportFramePreferences
} from '../src/renderer/src/editor/exportFramePreference';

/**
 * The shape a cut is exported into, on the desktop.
 *
 * The phone has offered this since portrait footage stopped coming out
 * pillarboxed. The desktop asked for nothing and exported at whatever the first
 * video *asset* happened to be — which is not the question the shared rule
 * answers. `outputFrameFor` reads the timeline's leading clip, so a project that
 * opens with its second import came out one shape here and another on a phone,
 * and the module that exists to stop a project silently changing shape was not
 * being called by half the app.
 */
describe('the remembered frame', () => {
  it('is the footage until someone says otherwise', () => {
    expect(DEFAULT_EXPORT_FRAME).toBe('source');
    expect(parseExportFramePreferences(null)).toEqual({});
  });

  it('keeps one answer per project, because the answer belongs to the cut', () => {
    const stored = serializeExportFramePreferences({ 'project-a': 'portrait', 'project-b': 'landscape' });
    expect(parseExportFramePreferences(stored)).toEqual({ 'project-a': 'portrait', 'project-b': 'landscape' });
  });

  it('does not write down the default, which is what an absent entry means', () => {
    const stored = serializeExportFramePreferences({ 'project-a': 'source', 'project-b': 'square' });
    expect(stored).not.toContain('project-a');
    expect(parseExportFramePreferences(stored)['project-b']).toBe('square');
  });

  it('treats anything unreadable as no preference rather than an error', () => {
    // A preference is not worth failing an editor over: the worst a bad entry
    // can do is export the shape the footage already is.
    expect(parseExportFramePreferences('not json')).toEqual({});
    expect(parseExportFramePreferences('[1,2,3]')).toEqual({});
    expect(parseExportFramePreferences('{"project-a":"widescreen"}')).toEqual({});
  });

  it('offers exactly the choices the shared rule knows', () => {
    expect([...EXPORT_FRAME_PREFERENCES].sort()).toEqual(['landscape', 'portrait', 'source', 'square']);
  });
});

describe('the export panel', () => {
  const read = () => readFile(new URL('../src/renderer/src/editor/ExportPanel.tsx', import.meta.url), 'utf8');

  it('decides the frame with the rule both surfaces share', async () => {
    const panel = await read();
    expect(panel).toContain("outputFrameFor({ timeline: project.timeline, assets: project.assets, preference: framePreference })");
  });

  it('sends the frame rather than leaving it to the fallback', async () => {
    // The main process falls back to the first video asset's size, which is the
    // answer this control exists to replace — so it has to be sent explicitly.
    const panel = await read();
    expect(panel).toContain('width: frame.width, height: frame.height');
  });

  it('says the size in pixels, not only the name of the shape', async () => {
    // "Portrait" is a choice; 1080 × 1920 is what the file will be.
    expect(await read()).toContain('${frame.width} × ${frame.height}');
  });
});
