import { describe, expect, it } from 'vitest';

import {
  containerMetadataProbeArgs,
  parseContainerMetadataProbeOutput
} from '../src/main/containerMetadataInspection';

describe('container metadata inspection', () => {
  it('asks FFprobe for tag names without selecting tag values in app code', () => {
    const args = containerMetadataProbeArgs('C:/private/source.mp4');
    expect(args).toContain('format_tags:stream_tags');
    expect(args.at(-1)).toBe('C:/private/source.mp4');
    expect(args.join(' ')).not.toContain('show_data');
  });

  it('returns only normalized allowlisted definitions and discards raw values and unknown keys', () => {
    const secret = 'Creator Name at C:/private/home with AIza-secret';
    const parsed = parseContainerMetadataProbeOutput(JSON.stringify({
      streams: [{ tags: { AUTHOR: secret, copyright: 'Keep provenance', language: 'eng' } }],
      format: { tags: { 'com.apple.quicktime.location.iso6709': '+10.000+106.000/', comment: secret } }
    }));

    expect(parsed).toMatchObject({
      checked: true,
      fields: [
        { key: 'com.apple.quicktime.location.ISO6709' },
        { key: 'author' },
        { key: 'comment' }
      ]
    });
    const serialized = JSON.stringify(parsed);
    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain('copyright');
    expect(serialized).not.toContain('language');
  });

  it('rejects invalid or incomplete probe output instead of claiming an empty inventory', () => {
    expect(parseContainerMetadataProbeOutput('not json')).toBeNull();
    expect(parseContainerMetadataProbeOutput('{}')).toBeNull();
    expect(parseContainerMetadataProbeOutput(JSON.stringify({ streams: [{ tags: 'not-an-object' }] }))).toBeNull();
    expect(parseContainerMetadataProbeOutput(JSON.stringify({ streams: ['not-a-stream'] }))).toBeNull();
    expect(parseContainerMetadataProbeOutput(JSON.stringify({ streams: [], format: {} }))).toEqual({ checked: true, fields: [] });
  });
});
