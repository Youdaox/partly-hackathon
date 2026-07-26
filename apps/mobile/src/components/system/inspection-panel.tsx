/**
 * The 3D vehicle on the results screen.
 *
 * A fixed-height panel rather than its own route: the parts list and the car
 * are the same answer seen two ways, and a repairer deciding what to order
 * should not have to leave the list to find out where a part sits. The legend
 * is on the panel because the two marker colours are the only thing that needs
 * explaining, and the drag hint because nothing else says the view is live.
 */

import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { ThemedText } from '@/components/themed-text';
import { VehicleViewer } from '@/components/VehicleViewer/VehicleViewer';
import { Faces, Intake, Round } from '@/constants/theme';
import type { DamageRegion } from '@/types/damage';

export function InspectionPanel({
  regions,
  showInvisible,
  selectedMeshName,
  onSelectPart,
  /** Suppressed on the confirmed tab — there is nothing predicted to explain. */
  showInsight = false,
}: {
  regions: DamageRegion[];
  showInvisible: boolean;
  selectedMeshName: string | null;
  onSelectPart: (meshName: string) => void;
  showInsight?: boolean;
}) {
  // Dismissed by its own close button, and stays dismissed for this view: it is
  // a nudge the first time, clutter every time after.
  const [insightDismissed, setInsightDismissed] = useState(false);
  const insightVisible =
    showInsight && !insightDismissed && !selectedMeshName && regions.length > 0;

  return (
    <View style={styles.panel}>
      <VehicleViewer
        activeRegions={regions}
        showInvisible={showInvisible}
        selectedMeshName={selectedMeshName}
        onSelectPart={onSelectPart}
      />

      <View style={styles.legend} pointerEvents="none">
        <View style={styles.legendItem}>
          <View style={[styles.dot, { backgroundColor: Intake.markerVisible }]} />
          <ThemedText style={styles.legendText}>Visible</ThemedText>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.dot, { backgroundColor: Intake.markerPredicted }]} />
          <ThemedText style={styles.legendText}>AI-predicted</ThemedText>
        </View>
      </View>

      {/* Anchored to a corner and capped narrow rather than stretched across —
          the point is a small nudge over the car, not a card blocking the view. */}
      {insightVisible ? (
        <View style={styles.insight}>
          <View style={styles.insightHead}>
            <ThemedText style={styles.insightTitle}>AI Insight</ThemedText>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Dismiss AI insight"
              onPress={() => setInsightDismissed(true)}
              hitSlop={10}
              style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
            >
              <Ionicons name="close" size={15} color="#F2F4F7" />
            </Pressable>
          </View>
          <ThemedText style={styles.insightBody} numberOfLines={3}>
            The collision angle and bumper deformation suggest damage behind the visible
            impact area. Tap a glowing part to see why.
          </ThemedText>
        </View>
      ) : null}

      <ThemedText style={styles.hint} pointerEvents="none">
        Drag to rotate
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    height: 246,
    borderRadius: Round.media,
    backgroundColor: Intake.panel,
    overflow: 'hidden',
  },
  legend: {
    position: 'absolute',
    top: 10,
    left: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: Round.pill,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 7, height: 7, borderRadius: Round.pill },
  legendText: { fontFamily: Faces.sansMedium, fontSize: 11.5, color: '#FFFFFF' },
  insight: {
    position: 'absolute',
    left: 10,
    bottom: 10,
    maxWidth: '62%',
    borderRadius: Round.card - 4,
    padding: 8,
    gap: 2,
    backgroundColor: 'rgba(16, 20, 28, 0.72)',
  },
  insightHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  insightTitle: { fontFamily: Faces.sansMedium, fontSize: 11.5, color: '#FFFFFF' },
  insightBody: { fontFamily: Faces.sans, fontSize: 11, lineHeight: 15, color: '#D8DAE0' },
  hint: {
    position: 'absolute',
    right: 12,
    bottom: 10,
    fontFamily: Faces.sans,
    fontSize: 11,
    color: 'rgba(255,255,255,0.5)',
  },
});
