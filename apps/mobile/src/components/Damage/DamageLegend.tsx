/**
 * Small colour-key row explaining the two overlay styles on the 3D viewer.
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
import { Spacing } from '@/constants/theme';

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
    <View style={styles.row}>
      <View style={styles.item}>
        <View style={[styles.dot, { backgroundColor: '#FF5A36' }]} />
        <ThemedText type="small" themeColor="textSecondary">
          Visible damage
        </ThemedText>
      </View>
      <View style={styles.item}>
        <Animated.View style={[styles.dot, { backgroundColor: '#7C5CFF' }, invisibleDotStyle]} />
        <ThemedText type="small" themeColor="textSecondary">
          AI-predicted (hidden)
        </ThemedText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: Spacing.four },
  item: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  dot: { width: 10, height: 10, borderRadius: 5 },
});
