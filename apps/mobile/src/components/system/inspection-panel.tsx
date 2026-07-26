/**
 * The 3D vehicle on the results screen.
 *
 * A fixed-height panel rather than its own route: the parts list and the car
 * are the same answer seen two ways, and a repairer deciding what to order
 * should not have to leave the list to find out where a part sits. The legend
 * is on the panel because the two marker colours are the only thing that needs
 * explaining, and the drag hint because nothing else says the view is live.
 */

import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { VehicleViewer } from '@/components/VehicleViewer/VehicleViewer';
import { Faces, Intake, Round } from '@/constants/theme';
import type { DamageRegion } from '@/types/damage';

export function InspectionPanel({
  regions,
  showInvisible,
  selectedMeshName,
  onSelectPart,
}: {
  regions: DamageRegion[];
  showInvisible: boolean;
  selectedMeshName: string | null;
  onSelectPart: (meshName: string) => void;
}) {
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
  hint: {
    position: 'absolute',
    right: 12,
    bottom: 10,
    fontFamily: Faces.sans,
    fontSize: 11,
    color: 'rgba(255,255,255,0.5)',
  },
});
