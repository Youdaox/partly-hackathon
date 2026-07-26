/**
 * Small colour-key chip explaining the two overlay styles on the 3D viewer.
 *
 * Floats over the dark stage, so it carries its own dark translucent backing and
 * light text rather than following the page theme — it needs to read the same
 * regardless of what part of the car is behind it.
 */

import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';

export function DamageLegend() {
  const pulse = useSharedValue(0.4);

  useEffect(() => {
    pulse.value = withRepeat(
      withTiming(1, { duration: 800, easing: Easing.inOut(Easing.sin) }),
      -1,
      true,
    );
  }, [pulse]);

  const invisibleDotStyle = useAnimatedStyle(() => ({ opacity: pulse.value }));

  return (
    <View style={styles.card}>
      <View style={styles.item}>
        <View style={[styles.dot, { backgroundColor: '#FF5A36' }]} />
        <ThemedText type="small" style={styles.label}>
          Visible
        </ThemedText>
      </View>
      <View style={styles.item}>
        <Animated.View style={[styles.dot, { backgroundColor: '#7C5CFF' }, invisibleDotStyle]} />
        <ThemedText type="small" style={styles.label}>
          AI-predicted
        </ThemedText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    gap: Spacing.three,
    backgroundColor: 'rgba(10,14,20,0.55)',
    borderRadius: Radius.round,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  item: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  dot: { width: 8, height: 8, borderRadius: 4 },
  label: { color: '#F2F4F7' },
});
