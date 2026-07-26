/**
 * Bottom sheet shown when a repairer taps any part on the 3D viewer.
 *
 * This is a locate-a-part tool first, a damage viewer second: tapping an
 * undamaged part (most of them, most of the time) still opens the sheet, just
 * with a short "no damage reported" version instead of a parts list —
 * naming and finding a part is the baseline, damage detail is what's layered on
 * top when there's something to say.
 *
 * A region groups every real catalogue part that mapped onto this mesh (see
 * `lib/damage-regions.ts`), so the sheet's real content is that list — each row
 * is one actual part, tappable through to its own exploded diagram, rather than
 * one description for the whole area.
 *
 * Deliberately a hand-rolled Modal + Reanimated slide rather than a bottom-sheet
 * library — this app has no such dependency yet and the interaction here (open,
 * close, one static content size) doesn't need one.
 */

import { useEffect } from 'react';
import { Dimensions, FlatList, Modal, Pressable, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';

import { ThemedText } from '@/components/themed-text';
import { MatchBadge, Pill } from '@/components/ui';
import { Spacing, TapTarget } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { DamageRegion, RegionPart } from '@/types/damage';

const SHEET_HEIGHT = Math.min(Dimensions.get('window').height * 0.62, 560);

interface PartBottomSheetProps {
  /** The part that was tapped — null when nothing is selected (sheet stays hidden). */
  meshName: string | null;
  /** Display label for `meshName`, shown whether or not there's a DamageRegion. */
  label: string;
  /** Present only when real report parts mapped onto this mesh. */
  region: DamageRegion | null;
  visible: boolean;
  onClose: () => void;
  /** Open the exploded diagram for one specific real part. */
  onSelectPart: (part: RegionPart) => void;
}

export function PartBottomSheet({
  meshName,
  label,
  region,
  visible,
  onClose,
  onSelectPart,
}: PartBottomSheetProps) {
  const theme = useTheme();
  const translateY = useSharedValue(SHEET_HEIGHT);

  useEffect(() => {
    translateY.value = withTiming(visible ? 0 : SHEET_HEIGHT, { duration: 260 });
  }, [visible, translateY]);

  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  if (!meshName) return null;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <Animated.View
        style={[
          styles.sheet,
          sheetStyle,
          { backgroundColor: theme.background, borderColor: theme.border, height: SHEET_HEIGHT },
        ]}
      >
        <View style={styles.handle} />

        <View style={styles.headerRow}>
          <ThemedText type="subtitle" style={styles.headerTitle}>
            {label}
          </ThemedText>
          {region ? (
            <Pill
              label={`${region.parts.length} part${region.parts.length === 1 ? '' : 's'}`}
              tone={region.damageType === 'visible' ? 'accent' : 'neutral'}
            />
          ) : null}
        </View>

        {region ? (
          <FlatList
            data={region.parts}
            keyExtractor={(part) => part.partId}
            contentContainerStyle={styles.list}
            renderItem={({ item }) => (
              <PartRow part={item} onPress={() => onSelectPart(item)} />
            )}
          />
        ) : (
          <ThemedText type="small" themeColor="textSecondary">
            No damage reported for this part.
          </ThemedText>
        )}
      </Animated.View>
    </Modal>
  );
}

/** One real catalogue part — name, its status, and a way into its exploded diagram. */
function PartRow({ part, onPress }: { part: RegionPart; onPress: () => void }) {
  const theme = useTheme();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`View ${part.name} exploded diagram`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        { borderColor: theme.border, opacity: pressed ? 0.6 : 1 },
      ]}
    >
      <View style={styles.rowMain}>
        <View style={styles.rowNameLine}>
          <ThemedText type="smallBold" style={styles.rowName} numberOfLines={2}>
            {part.name}
            {part.qty > 1 ? ` ×${part.qty}` : ''}
          </ThemedText>
          <PartStatus part={part} />
        </View>
        {part.reason ? (
          <ThemedText type="small" themeColor="textSecondary" numberOfLines={2}>
            {part.reason}
          </ThemedText>
        ) : null}
      </View>
      <Ionicons name="chevron-forward" size={18} color={theme.iconMuted} />
    </Pressable>
  );
}

/** Visible = a stated fact, no number. Predicted = a match badge. Inspected = settled. */
function PartStatus({ part }: { part: RegionPart }) {
  const theme = useTheme();

  if (part.confirmed != null) {
    return (
      <Ionicons
        name={part.confirmed ? 'checkmark-circle' : 'close-circle-outline'}
        size={18}
        color={part.confirmed ? theme.success : theme.textSecondary}
      />
    );
  }
  if (part.bucket === 'visible') {
    return <Ionicons name="checkmark" size={18} color={theme.textSecondary} />;
  }
  return <MatchBadge value={part.p} />;
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.5)' },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    borderTopLeftRadius: Spacing.four,
    borderTopRightRadius: Spacing.four,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.four,
    gap: Spacing.three,
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#8888',
    marginBottom: Spacing.one,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.two },
  headerTitle: { flex: 1, fontSize: 22, lineHeight: 28 },
  list: { gap: Spacing.one, paddingBottom: Spacing.three },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    minHeight: TapTarget,
    paddingVertical: Spacing.two,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowMain: { flex: 1, gap: 2 },
  rowNameLine: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  rowName: { flex: 1 },
});
