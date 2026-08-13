import { useEffect, useRef } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';

import { theme } from '../lib/theme';

/**
 * The program monitor.
 *
 * One player, re-pointed as the playhead crosses clips, rather than one player
 * per clip: a phone will not keep a dozen decoders alive, and a timeline is
 * allowed to have a dozen clips.
 *
 * Seeking is only issued when the target has actually moved — assigning
 * `currentTime` restarts the decoder, so echoing back the position the player
 * itself just reported would stutter the picture on every tick of playback.
 */
export function PreviewPlayer({
  uri,
  still,
  sourceTimeMs,
  playing,
  onProgress,
  onEnded
}: {
  readonly uri: string | null;
  /**
   * A still is picture with no timeline of its own, so there is nothing for a
   * video player to open. It is shown, and the playhead runs over it the way it
   * runs over a gap.
   */
  readonly still?: boolean;
  readonly sourceTimeMs: number;
  readonly playing: boolean;
  /** Source position, in ms, reported while playing. */
  readonly onProgress: (sourceTimeMs: number) => void;
  readonly onEnded: () => void;
}) {
  const player = useVideoPlayer(null, (instance) => {
    instance.timeUpdateEventInterval = 0.05;
  });
  const loadedUri = useRef<string | null>(null);
  const lastSeekMs = useRef(0);

  useEffect(() => {
    // A still never reaches the player: expo-video has nothing to open, and the
    // failed load would clear whatever the player was showing.
    const source = still === true ? null : uri;
    if (source === loadedUri.current) return;
    loadedUri.current = source;
    // replaceAsync rather than replace: on iOS the synchronous form blocks the
    // UI thread while the asset loads, which shows up as a frozen scrub.
    void player.replaceAsync(source === null ? null : { uri: source }).catch(() => {
      loadedUri.current = null;
    });
  }, [uri, still, player]);

  useEffect(() => {
    const target = Math.max(0, sourceTimeMs) / 1000;
    if (Math.abs(target - lastSeekMs.current / 1000) < 0.08) return;
    lastSeekMs.current = Math.max(0, sourceTimeMs);
    player.currentTime = target;
  }, [sourceTimeMs, player]);

  useEffect(() => {
    if (playing) player.play();
    else player.pause();
  }, [playing, player]);

  useEffect(() => {
    const subscription = player.addListener('timeUpdate', ({ currentTime }) => {
      lastSeekMs.current = currentTime * 1000;
      onProgress(currentTime * 1000);
    });
    const ended = player.addListener('playToEnd', () => onEnded());
    return () => {
      subscription.remove();
      ended.remove();
    };
  }, [player, onProgress, onEnded]);

  return (
    <View style={styles.root}>
      {uri !== null && still === true ? (
        <Image style={styles.video} source={{ uri }} resizeMode="contain" accessibilityLabel="Still under the playhead" />
      ) : uri === null ? (
        // A gap is black on export, so it is black here too rather than showing
        // the last frame that happened to be decoded.
        <View style={styles.empty}>
          <Text style={styles.emptyText}>No clip under the playhead</Text>
        </View>
      ) : (
        <VideoView style={styles.video} player={player} contentFit="contain" nativeControls={false} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { width: '100%', aspectRatio: 16 / 9, backgroundColor: '#000000' },
  video: { width: '100%', height: '100%' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyText: { color: theme.textWeaker, fontSize: 12 }
});
