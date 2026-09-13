import { protocol } from 'electron';

import { MEDIA_PLAYBACK_SCHEME } from '../shared/mediaPlaybackUrls';
import { createTimelineAssetRequestHandler, type MediaPlaybackResolver } from './timelineAssetResponse';

export const PLAYBACK_SCHEME = MEDIA_PLAYBACK_SCHEME;

export function registerTimelineAssetScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: PLAYBACK_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true }
    }
  ]);
}

export function registerTimelineAssetProtocol(resolver: MediaPlaybackResolver): void {
  protocol.handle(PLAYBACK_SCHEME, createTimelineAssetRequestHandler(resolver));
}
