/**
 * Visible / AI-predicted damage toggle — the same "big number, label under it"
 * stat-box language as the diagnosis report's filter pair (case-report.tsx), so
 * this screen reads as the same app rather than a bolted-on viewer.
 *
 * Both are independent switches (not a segmented either/or) so a repairer can look at
 * visible and AI-inferred damage side by side. Each box fills with its own halo colour
 * when active — the same orange/purple the 3D viewer and the parts list use — so the
 * toggle visibly explains what it's filtering rather than just being another navy tab.
 */

import { useEffect } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

const VISIBLE_COLOR = '#FF5A36';
const INVISIBLE_COLOR = '#7C5CFF';

interface DamageToggleProps {
  visibleCount: number;
  invisibleCount: number;
  showVisible: boolean;
  showInvisible: boolean;
  onToggleVisible: () => void;
  onToggleInvisible: () => void;
}

export function DamageToggle({
  visibleCount,
  invisibleCount,
  showVisible,
  showInvisible,
  onToggleVisible,
  onToggleInvisible,
}: DamageToggleProps) {
  return (
    <View style={styles.row}>
      <ToggleBox
        label="Visible"
        count={visibleCount}
        active={showVisible}
        color={VISIBLE_COLOR}
        onPress={onToggleVisible}
      />
      <ToggleBox
        label="AI-predicted"
        count={invisibleCount}
        active={showInvisible}
        color={INVISIBLE_COLOR}
        pulse
        onPress={onToggleInvisible}
      />
    </View>
  );
}

function ToggleBox({
  label,
  count,
  active,
  color,
  onPress,
  pulse = false,
}: {
  label: string;
  count: number;
  active: boolean;
  color: string;
  onPress: () => void;
  pulse?: boolean;
}) {
  const theme = useTheme();
  const pulseValue = useSharedValue(0.4);

  useEffect(() => {
    if (pulse && active) {
      pulseValue.value = withRepeat(
        withTiming(1, { duration: 800, easing: Easing.inOut(Easing.sin) }),
        -1,
        true,
      );
    } else {
      pulseValue.value = 0.4;
    }
  }, [pulse, active, pulseValue]);

  const dotStyle = useAnimatedStyle(() => ({ opacity: pulseValue.value }));

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={`${label}, ${count} parts`}
      style={({ pressed }) => [
        styles.box,
        {
          borderColor: active ? color : theme.border,
          backgroundColor: active ? color : theme.backgroundElement,
          transform: [{ scale: pressed ? 0.97 : 1 }],
        },
      ]}
    >
      <View style={styles.boxHead}>
        <ThemedText type="heading" style={[styles.count, { color: active ? '#FFFFFF' : theme.text }]}>
          {count}
        </ThemedText>
        {pulse ? (
          <Animated.View
            style={[styles.dot, dotStyle, { backgroundColor: active ? '#FFFFFF' : color }]}
          />
        ) : null}
      </View>
      <ThemedText type="smallBold" style={{ color: active ? '#FFFFFF' : theme.textSecondary }}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: Spacing.two },
  box: {
    flex: 1,
    gap: Spacing.one,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.card,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
  },
  boxHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  count: { fontSize: 28, lineHeight: 32 },
  dot: { width: 8, height: 8, borderRadius: 4 },
});
