/**
 * One damage region, summarised — used in the "Damage summary" sheet and reusable
 * anywhere else a compact damage row is needed.
 */

import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Card, ConfidenceBar, Pill } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import type { DamageRegion } from '@/types/damage';

interface DamageCardProps {
  region: DamageRegion;
  onPress?: () => void;
}

export function DamageCard({ region, onPress }: DamageCardProps) {
  const content = (
    <Card style={styles.card}>
      <View style={styles.header}>
        <ThemedText type="smallBold" style={styles.title}>
          {region.partName}
        </ThemedText>
        <Pill
          label={region.damageType === 'visible' ? 'Visible' : 'AI-predicted'}
          tone={region.damageType === 'visible' ? 'accent' : 'neutral'}
        />
      </View>
      <ThemedText type="small" themeColor="textSecondary">
        {region.description}
      </ThemedText>
      {/* Observed = no number, predicted = number. A visible part was seen; a
          percentage next to it reads as hedging about a fact, and it blurs the
          one distinction this screen exists to make. */}
      {region.damageType === 'invisible' ? <ConfidenceBar value={region.confidence} /> : null}
    </Card>
  );

  if (!onPress) return content;

  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => ({ opacity: pressed ? 0.75 : 1 })}>
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { gap: Spacing.one },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.two },
  title: { flex: 1 },
});
