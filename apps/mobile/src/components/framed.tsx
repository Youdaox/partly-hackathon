/**
 * The crop-mark frame from the mockups: a hairline rule top and bottom, with a small
 * `+` tick sitting on each corner.
 *
 * It reads as a registration mark on a print layout, which is the whole point — it
 * frames a block of content without boxing it in the way a full border does. Built
 * from plain Views rather than SVG because it is four crosses and nothing more.
 */

import { StyleSheet, View, type ViewProps } from 'react-native';

import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/** Arm length of one crop mark, in points. */
const MARK = 13;

function CropMark({ vertical, horizontal }: { vertical: 'top' | 'bottom'; horizontal: 'left' | 'right' }) {
  const theme = useTheme();

  return (
    <View
      pointerEvents="none"
      style={[
        styles.mark,
        vertical === 'top' ? { top: -MARK / 2 } : { bottom: -MARK / 2 },
        horizontal === 'left' ? { left: -MARK / 2 } : { right: -MARK / 2 },
      ]}
    >
      <View style={[styles.markArmH, { backgroundColor: theme.cropMark }]} />
      <View style={[styles.markArmV, { backgroundColor: theme.cropMark }]} />
    </View>
  );
}

export interface FramedProps extends ViewProps {
  /** Draw the hairline rules as well as the corner ticks. Defaults to true. */
  rules?: boolean;
}

export function Framed({ children, style, rules = true, ...rest }: FramedProps) {
  const theme = useTheme();

  return (
    <View
      style={[
        styles.frame,
        rules && { borderTopColor: theme.border, borderBottomColor: theme.border },
        rules && styles.ruled,
        style,
      ]}
      {...rest}
    >
      {children}
      <CropMark vertical="top" horizontal="left" />
      <CropMark vertical="top" horizontal="right" />
      <CropMark vertical="bottom" horizontal="left" />
      <CropMark vertical="bottom" horizontal="right" />
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    // Marks hang outside the content box, so they must not be clipped.
    overflow: 'visible',
    paddingVertical: Spacing.three,
  },
  ruled: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  mark: {
    position: 'absolute',
    width: MARK,
    height: MARK,
    alignItems: 'center',
    justifyContent: 'center',
  },
  markArmH: {
    position: 'absolute',
    width: MARK,
    height: StyleSheet.hairlineWidth * 2,
  },
  markArmV: {
    position: 'absolute',
    width: StyleSheet.hairlineWidth * 2,
    height: MARK,
  },
});
