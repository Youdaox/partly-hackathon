/**
 * Bottom sheet shown when a repairer taps any part on the 3D viewer.
 *
 * This is a locate-a-part tool first, a damage viewer second: tapping an
 * undamaged part (most of them, most of the time) still opens the sheet, just
 * with a short "no damage reported" version instead of the full AI writeup —
 * naming and finding a part is the baseline, damage detail is what's layered on
 * top when there's something to say.
 *
 * Deliberately a hand-rolled Modal + Reanimated slide rather than a bottom-sheet
 * library — this app has no such dependency yet and the interaction here (open,
 * close, one static content size) doesn't need one.
 */

import { useEffect } from 'react';
import { Dimensions, Modal, Pressable, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';
import { Button, ConfidenceBar, Pill } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { DamageRegion } from '@/types/damage';

const SHEET_HEIGHT = Math.min(Dimensions.get('window').height * 0.6, 520);

interface PartBottomSheetProps {
  /** The part that was tapped — null when nothing is selected (sheet stays hidden). */
  meshName: string | null;
  /** Display label for `meshName`, shown whether or not there's a DamageRegion. */
  label: string;
  /** Present only when the AI has something to say about this part. */
  region: DamageRegion | null;
  visible: boolean;
  onClose: () => void;
  onViewDiagram: () => void;
}

export function PartBottomSheet({
  meshName,
  label,
  region,
  visible,
  onClose,
  onViewDiagram,
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
              label={region.damageType === 'visible' ? 'Visible' : 'AI-predicted'}
              tone={region.damageType === 'visible' ? 'accent' : 'neutral'}
            />
          ) : null}
        </View>

        {region ? (
          <>
            <Section label="Damage">
              <ThemedText type="default">{region.description}</ThemedText>
            </Section>

            <Section label="Confidence">
              <ConfidenceBar value={region.confidence} />
            </Section>

            <Section label="AI Insight">
              <View style={[styles.insightCard, { backgroundColor: theme.backgroundElement }]}>
                <ThemedText type="small">{region.explanation}</ThemedText>
              </View>
            </Section>

            <Section label="Related parts">
              <View style={styles.chipsRow}>
                {region.parts.map((part) => (
                  <View key={part} style={[styles.partChip, { backgroundColor: theme.backgroundSelected }]}>
                    <ThemedText type="small">{part}</ThemedText>
                  </View>
                ))}
              </View>
            </Section>

            <Button title="View exploded diagram" onPress={onViewDiagram} variant="secondary" fullWidth />
          </>
        ) : (
          <ThemedText type="small" themeColor="textSecondary">
            No damage reported for this part.
          </ThemedText>
        )}
      </Animated.View>
    </Modal>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <ThemedText type="smallBold" themeColor="textSecondary" style={styles.sectionLabel}>
        {label.toUpperCase()}
      </ThemedText>
      {children}
    </View>
  );
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
  section: { gap: Spacing.one },
  sectionLabel: { letterSpacing: 0.5 },
  insightCard: { borderRadius: Spacing.two, padding: Spacing.three },
  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.one },
  partChip: { paddingHorizontal: Spacing.two, paddingVertical: Spacing.half, borderRadius: Spacing.four },
});
