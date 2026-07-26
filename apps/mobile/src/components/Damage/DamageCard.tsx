/**
 * One damage region, as a row in the inspection screen's docked parts list.
 *
 * The leading dot is the same orange/purple as the region's halo on the car and the
 * DamageLegend chip, so a repairer can connect a list row to what's glowing above it
 * without reading anything. `selected` tints the row to match the currently-focused
 * part, so the list visibly tracks whatever is highlighted on the car — the point of
 * docking the list under the viewer instead of hiding it in a modal.
 */

import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { ThemedText } from '@/components/themed-text';
import { MatchBadge } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { DamageRegion } from '@/types/damage';

const VISIBLE_COLOR = '#FF5A36';
const INVISIBLE_COLOR = '#7C5CFF';

interface DamageCardProps {
  region: DamageRegion;
  selected?: boolean;
  /** False on the first row in the list, so it doesn't draw a rule against the card's own top edge. */
  divider?: boolean;
  onPress?: () => void;
}

export function DamageCard({ region, selected = false, divider = true, onPress }: DamageCardProps) {
  const theme = useTheme();
  const color = region.damageType === 'visible' ? VISIBLE_COLOR : INVISIBLE_COLOR;
  const extra = region.parts.length - 1;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={({ pressed }) => [
        styles.row,
        divider && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border },
        { backgroundColor: selected ? theme.badgeFill : 'transparent', opacity: pressed ? 0.7 : 1 },
      ]}
    >
      <View style={[styles.dot, { backgroundColor: color }]} />

      <View style={styles.body}>
        <ThemedText numberOfLines={1}>
          {region.partName}
          {extra > 0 ? (
            <ThemedText type="small" themeColor="textSecondary">
              {'  +'}
              {extra} more
            </ThemedText>
          ) : null}
        </ThemedText>
        {/* Visible damage: the title already says the name and how many more are
            grouped with it, and `description` for a single-part region is just that
            same name again — showing both read as a stutter. Predicted damage is
            different: `description` there is the *reason*, genuinely new information. */}
        {region.damageType === 'invisible' ? (
          <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
            {region.description}
          </ThemedText>
        ) : null}
      </View>

      {region.damageType === 'invisible' ? (
        <MatchBadge value={region.confidence} />
      ) : (
        <Ionicons name="checkmark-circle" size={18} color={theme.success} />
      )}
      <Ionicons name="chevron-forward" size={18} color={theme.iconMuted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    minHeight: 64,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  dot: { width: 10, height: 10, borderRadius: 5 },
  body: { flex: 1, gap: 2 },
});
