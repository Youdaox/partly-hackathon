/**
 * Visible / Invisible damage toggle row.
 *
 * Both are independent switches (not a segmented either/or) so a repairer can look at
 * visible and AI-inferred damage side by side. The invisible chip gets a slow
 * Reanimated glow pulse while active — the "AI is watching" cue for hidden damage.
 */

import { useEffect } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

interface DamageToggleProps {
  showVisible: boolean;
  showInvisible: boolean;
  onToggleVisible: () => void;
  onToggleInvisible: () => void;
}

export function DamageToggle({
  showVisible,
  showInvisible,
  onToggleVisible,
  onToggleInvisible,
}: DamageToggleProps) {
  return (
    <View style={styles.row}>
      <ToggleChip
        label="Visible Damage"
        active={showVisible}
        activeColor="#FF5A36"
        onPress={onToggleVisible}
      />
      <ToggleChip
        label="Invisible Damage"
        active={showInvisible}
        activeColor="#7C5CFF"
        glow
        onPress={onToggleInvisible}
      />
    </View>
  );
}

function ToggleChip({
  label,
  active,
  activeColor,
  onPress,
  glow = false,
}: {
  label: string;
  active: boolean;
  activeColor: string;
  onPress: () => void;
  glow?: boolean;
}) {
  const theme = useTheme();
  const glowOpacity = useSharedValue(0);

  useEffect(() => {
    if (active && glow) {
      glowOpacity.value = withRepeat(
        withTiming(1, { duration: 900, easing: Easing.inOut(Easing.sin) }),
        -1,
        true,
      );
    } else {
      cancelAnimation(glowOpacity);
      glowOpacity.value = withTiming(0, { duration: 200 });
    }
  }, [active, glow, glowOpacity]);

  const glowStyle = useAnimatedStyle(() => ({
    opacity: glowOpacity.value * 0.35,
  }));

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      style={({ pressed }) => [
        styles.chip,
        {
          backgroundColor: active ? activeColor : theme.backgroundElement,
          borderColor: active ? activeColor : theme.border,
          opacity: pressed ? 0.8 : 1,
        },
      ]}
    >
      {glow ? (
        <Animated.View
          pointerEvents="none"
          style={[styles.glow, glowStyle, { backgroundColor: activeColor }]}
        />
      ) : null}
      <ThemedText type="smallBold" style={{ color: active ? '#fff' : theme.text }}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: Spacing.two },
  chip: {
    flex: 1,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.three,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  glow: {
    ...StyleSheet.absoluteFill,
    borderRadius: Spacing.three,
  },
});
