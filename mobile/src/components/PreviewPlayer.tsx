import { useEffect, useRef, useState } from 'react';
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
  onEnded,
  effects,
  frameWidth,
  dimOpacity
}: {
  readonly uri: string | null;
  /**
   * A still is picture with no timeline of its own, so there is nothing for a
   * video player to open. It is shown, and the playhead runs over it the way it
   * runs over a gap.
   */
  readonly still?: boolean;
  /**
   * What the clip under the playhead is set to look like.
   *
   * The preview used to take only a uri and a time, so Adjust changed a number
   * in the document and nothing on screen — someone dropping a clip to 10%
   * opacity saw a fully opaque picture and reasonably concluded the control was
   * broken. These are the same values `videoCompositionPlan` hands the exporter,
   * expressed as styles, so the preview and the render answer the same question
   * the same way.
   */
  readonly effects?: {
    readonly opacity: number;
    readonly scale: number;
    readonly positionX: number;
    readonly positionY: number;
    readonly rotation: number;
  };
  /**
   * Width of the frame the export renders into.
   *
   * `positionX/Y` are pixels in that frame, not fractions of it, so an offset
   * that reads as a third of the way across a 1920-wide render has to read the
   * same on a preview a quarter that size. Without this the same number would
   * mean two different distances.
   */
  readonly frameWidth?: number;
  /**
   * Black over the whole frame, for a dip-to-black transition.
   *
   * Separate from the clip's own opacity because it is a different thing: the
   * clip keeps what it was given and the dip is drawn on top, which is how the
   * desktop draws it and how the FFmpeg graph renders it.
   */
  readonly dimOpacity?: number;
  readonly sourceTimeMs: number;
  readonly playing: boolean;
  /** Source position, in ms, reported while playing. */
  readonly onProgress: (sourceTimeMs: number) => void;
  readonly onEnded: () => void;
}) {
  /** Measured, so an output-frame offset can be expressed at preview size. */
  const [viewWidth, setViewWidth] = useState(0);

  /*
    Composited the way the export composites it: offset, rotated, then scaled
    about the centre, with opacity over black. React Native applies a transform
    list right to left, which is the same order the FFmpeg graph builds it in —
    scale, then rotate, then overlay at an offset.
  */
  const ratio = frameWidth !== undefined && frameWidth > 0 && viewWidth > 0 ? viewWidth / frameWidth : 1;
  const composited =
    effects === undefined
      ? undefined
      : {
          transform: [
            { translateX: effects.positionX * ratio },
            { translateY: effects.positionY * ratio },
            { rotate: `${effects.rotation}deg` },
            { scale: Math.max(0, effects.scale) }
          ]
        };

  /*
    Opacity is a scrim rather than a style on the video.

    An Android video surface does not composite alpha — setting `opacity` on the
    `VideoView` leaves the picture fully solid, which is what made the control
    look broken in the first place. Painting black over it at the complementary
    alpha gives the same result the export does, because the export composites
    the clip over black too.
  */
  const clipDim = effects === undefined ? 0 : 1 - Math.max(0, Math.min(1, effects.opacity));
  // Whichever is darker wins: they are two ways of hiding the same picture, and
  // adding them would take a half-faded clip to black too early.
  const dim = Math.max(clipDim, Math.max(0, Math.min(1, dimOpacity ?? 0)));

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
    <View style={styles.root} onLayout={(event) => setViewWidth(event.nativeEvent.layout.width)}>
      {uri !== null && still === true ? (
        <Image
          style={[styles.video, composited]}
          source={{ uri }}
          resizeMode="contain"
          accessibilityLabel="Still under the playhead"
        />
      ) : uri === null ? (
        // A gap is black on export, so it is black here too rather than showing
        // the last frame that happened to be decoded.
        <View style={styles.empty}>
          <Text style={styles.emptyText}>No clip under the playhead</Text>
        </View>
      ) : (
        <VideoView style={[styles.video, composited]} player={player} contentFit="contain" nativeControls={false} />
      )}
      {dim > 0 && <View pointerEvents="none" style={[styles.scrim, { opacity: dim }]} />}
    </View>
  );
}

const styles = StyleSheet.create({
  // Clipped: a clip scaled past 100% is meant to fill the frame and be cut off
  // by it, exactly as the export crops it — not to paint over the title bar.
  root: { width: '100%', aspectRatio: 16 / 9, backgroundColor: '#000000', overflow: 'hidden' },
  scrim: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#000000' },
  video: { width: '100%', height: '100%' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyText: { color: theme.textWeaker, fontSize: 12 }
});
