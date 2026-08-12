import { StyleSheet, View } from 'react-native';

import { theme } from '../lib/theme';

/**
 * Transport and navigation icons, drawn from Views.
 *
 * They were emoji and glyphs — `‹`, `⏮`, `▶` — which render as whatever the
 * system font decides: on iOS `⏮` came out as a colour emoji sitting on a blue
 * rounded tile, nothing like the surrounding controls. Drawn shapes take their
 * colour from the theme, size from a prop, and look the same on both platforms.
 *
 * Triangles use the border trick rather than a vector library: it is a handful
 * of pixels of geometry and adding react-native-svg to draw four shapes would
 * cost a native dependency and a rebuild of the dev client.
 */

type IconProps = {
  readonly size?: number;
  readonly color?: string;
};

function Triangle({ size, color, pointing }: { size: number; color: string; pointing: 'left' | 'right' }) {
  return (
    <View
      style={{
        width: 0,
        height: 0,
        backgroundColor: 'transparent',
        borderTopWidth: size / 2,
        borderBottomWidth: size / 2,
        borderTopColor: 'transparent',
        borderBottomColor: 'transparent',
        ...(pointing === 'right'
          ? { borderLeftWidth: size * 0.86, borderLeftColor: color, borderRightWidth: 0 }
          : { borderRightWidth: size * 0.86, borderRightColor: color, borderLeftWidth: 0 })
      }}
    />
  );
}

export function PlayIcon({ size = 16, color = theme.bg }: IconProps) {
  // Nudged right by an eighth: a triangle centred on its bounding box reads as
  // left-of-centre inside a circle, which is why every play button offsets it.
  return (
    <View style={[styles.center, { marginLeft: size * 0.12 }]}>
      <Triangle size={size} color={color} pointing="right" />
    </View>
  );
}

export function PauseIcon({ size = 16, color = theme.bg }: IconProps) {
  return (
    <View style={[styles.row, { gap: size * 0.28 }]}>
      <View style={{ width: size * 0.28, height: size, backgroundColor: color, borderRadius: 1 }} />
      <View style={{ width: size * 0.28, height: size, backgroundColor: color, borderRadius: 1 }} />
    </View>
  );
}

/** Skip to the previous edge: a bar with a triangle running into it. */
export function SkipBackIcon({ size = 14, color = theme.text }: IconProps) {
  return (
    <View style={[styles.row, { gap: size * 0.12 }]}>
      <View style={{ width: size * 0.2, height: size, backgroundColor: color, borderRadius: 1 }} />
      <Triangle size={size} color={color} pointing="left" />
    </View>
  );
}

export function SkipForwardIcon({ size = 14, color = theme.text }: IconProps) {
  return (
    <View style={[styles.row, { gap: size * 0.12 }]}>
      <Triangle size={size} color={color} pointing="right" />
      <View style={{ width: size * 0.2, height: size, backgroundColor: color, borderRadius: 1 }} />
    </View>
  );
}

/** A chevron, from two borders of a rotated square. */
export function ChevronLeftIcon({ size = 16, color = theme.text }: IconProps) {
  return (
    <View
      style={{
        width: size * 0.62,
        height: size * 0.62,
        borderLeftWidth: 2,
        borderBottomWidth: 2,
        borderColor: color,
        transform: [{ rotate: '45deg' }],
        // The stroke is drawn on the corner, so the shape sits right of centre
        // until it is pulled back.
        marginLeft: size * 0.16
      }}
    />
  );
}

export function GearIcon({ size = 18, color = theme.text }: IconProps) {
  // A ring with four teeth: enough to read as settings at 18pt, where a
  // full-toothed gear turns to mush anyway.
  return (
    <View style={[styles.center, { width: size, height: size }]}>
      {[0, 45, 90, 135].map((angle) => (
        <View
          key={angle}
          style={{
            position: 'absolute',
            width: size * 0.16,
            height: size,
            backgroundColor: color,
            borderRadius: 1,
            transform: [{ rotate: `${angle}deg` }]
          }}
        />
      ))}
      <View
        style={{
          width: size * 0.62,
          height: size * 0.62,
          borderRadius: size * 0.31,
          borderWidth: size * 0.16,
          borderColor: color
        }}
      />
      <View
        style={{
          position: 'absolute',
          width: size * 0.26,
          height: size * 0.26,
          borderRadius: size * 0.13,
          backgroundColor: theme.bg
        }}
      />
    </View>
  );
}

/**
 * Tab icons.
 *
 * The bar used `▤ ◫ ◍ ◈ ✦`, which is the same mistake the transport row made:
 * a glyph is rendered by whichever font the system picks, at whatever weight and
 * baseline that font has, and two of these five are in the emoji range on
 * Android. Drawn shapes take their colour from the caller, so a selected tab is
 * actually the accent colour rather than an emoji that ignores it.
 */

/** Stacked bars of different lengths — a cut, seen end on. */
export function TimelineIcon({ size = 20, color = theme.text }: IconProps) {
  return (
    <View style={{ width: size, height: size, justifyContent: 'center', gap: size * 0.16 }}>
      {[1, 0.62, 0.84].map((fraction, index) => (
        <View
          key={index}
          style={{ width: size * fraction, height: size * 0.16, borderRadius: size * 0.08, backgroundColor: color }}
        />
      ))}
    </View>
  );
}

/** A frame with a play triangle in it. */
export function ClapperIcon({ size = 20, color = theme.text }: IconProps) {
  return (
    <View
      style={[
        styles.center,
        {
          width: size,
          height: size * 0.82,
          borderWidth: size * 0.1,
          borderColor: color,
          borderRadius: size * 0.16
        }
      ]}
    >
      <Triangle size={size * 0.34} color={color} pointing="right" />
    </View>
  );
}

/** A level meter: five bars, tallest in the middle. */
export function WaveIcon({ size = 20, color = theme.text }: IconProps) {
  return (
    <View style={[styles.row, { width: size, height: size, gap: size * 0.09, justifyContent: 'center' }]}>
      {[0.34, 0.66, 1, 0.66, 0.34].map((fraction, index) => (
        <View
          key={index}
          style={{ width: size * 0.13, height: size * fraction, borderRadius: size * 0.07, backgroundColor: color }}
        />
      ))}
    </View>
  );
}

/** A picture frame with a sun in the corner. */
export function PictureIcon({ size = 20, color = theme.text }: IconProps) {
  return (
    <View
      style={{
        width: size,
        height: size * 0.86,
        borderWidth: size * 0.1,
        borderColor: color,
        borderRadius: size * 0.16,
        overflow: 'hidden'
      }}
    >
      <View
        style={{
          position: 'absolute',
          top: size * 0.1,
          left: size * 0.12,
          width: size * 0.18,
          height: size * 0.18,
          borderRadius: size * 0.09,
          backgroundColor: color
        }}
      />
      <View
        style={{
          position: 'absolute',
          bottom: -size * 0.22,
          right: -size * 0.06,
          width: size * 0.62,
          height: size * 0.62,
          borderRadius: size * 0.12,
          backgroundColor: color,
          transform: [{ rotate: '45deg' }]
        }}
      />
    </View>
  );
}

/**
 * A four-pointed spark, for the assistant.
 *
 * Two crossed bars, rounded until the arms taper. The first attempt was a square
 * with a smaller square rotated 45° on top of it, which is geometry that cancels
 * itself: at those sizes the diamond's half-diagonal and the square's half-width
 * came out equal, so the rotated one sat entirely inside the other and the tab
 * rendered a plain square. Caught on a device, not in review.
 */
export function SparkIcon({ size = 20, color = theme.text }: IconProps) {
  // Four triangles meeting at the centre. Crossed bars were the second attempt
  // and they do separate into four arms, but a bar has parallel sides: with no
  // taper the tab drew a plus, which in a tab bar reads as "add". The arms have
  // to come to a point for the shape to be a spark at all.
  const half = size / 2;
  const base = size * 0.17;
  const clear = { borderColor: 'transparent', backgroundColor: 'transparent', width: 0, height: 0 } as const;
  return (
    <View style={[styles.center, { width: size, height: size }]}>
      <View
        style={[clear, { position: 'absolute', top: 0, left: half - base, borderLeftWidth: base, borderRightWidth: base, borderBottomWidth: half, borderBottomColor: color }]}
      />
      <View
        style={[clear, { position: 'absolute', top: half, left: half - base, borderLeftWidth: base, borderRightWidth: base, borderTopWidth: half, borderTopColor: color }]}
      />
      <View
        style={[clear, { position: 'absolute', left: 0, top: half - base, borderTopWidth: base, borderBottomWidth: base, borderRightWidth: half, borderRightColor: color }]}
      />
      <View
        style={[clear, { position: 'absolute', left: half, top: half - base, borderTopWidth: base, borderBottomWidth: base, borderLeftWidth: half, borderLeftColor: color }]}
      />
    </View>
  );
}

/** Stacked sheets, for the collection of what a project holds. */
export function StackIcon({ size = 20, color = theme.text }: IconProps) {
  return (
    <View style={{ width: size, height: size, justifyContent: 'center' }}>
      {[0, 1, 2].map((row) => (
        <View
          key={row}
          style={{
            position: 'absolute',
            left: size * 0.06 * row,
            top: size * (0.12 + row * 0.22),
            width: size * (0.88 - row * 0.12),
            height: size * 0.2,
            borderRadius: size * 0.05,
            borderWidth: row === 2 ? 0 : size * 0.075,
            borderColor: color,
            backgroundColor: row === 2 ? color : 'transparent'
          }}
        />
      ))}
    </View>
  );
}

/** A pencil, for rename: a diagonal body with a squared-off tip below it. */
export function PencilIcon({ size = 18, color = theme.textWeak }: IconProps) {
  return (
    <View style={[styles.center, { width: size, height: size }]}>
      <View
        style={{
          width: size * 0.68,
          height: size * 0.22,
          borderRadius: size * 0.04,
          backgroundColor: color,
          transform: [{ rotate: '-45deg' }, { translateX: size * 0.08 }]
        }}
      />
      <View
        style={{
          position: 'absolute',
          left: size * 0.14,
          bottom: size * 0.14,
          width: size * 0.2,
          height: size * 0.2,
          borderRadius: size * 0.04,
          backgroundColor: color
        }}
      />
    </View>
  );
}

/** An ✕, from two bars. */
export function CloseIcon({ size = 16, color = theme.textWeak }: IconProps) {
  return (
    <View style={[styles.center, { width: size, height: size }]}>
      {['45deg', '-45deg'].map((rotate) => (
        <View
          key={rotate}
          style={{
            position: 'absolute',
            width: size * 0.9,
            height: Math.max(1.5, size * 0.11),
            borderRadius: 1,
            backgroundColor: color,
            transform: [{ rotate }]
          }}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  center: { alignItems: 'center', justifyContent: 'center' }
});
