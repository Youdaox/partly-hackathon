/**
 * AI Damage Inspection Viewer — screen 4.
 *
 * A repairer's tool for locating and identifying parts on a vehicle first, and
 * seeing AI damage predictions second: every part on the car is tappable, whether
 * or not anything is wrong with it. Toggling "Invisible Damage" doubles as an
 * X-ray mode that reveals parts not visible from outside (engine, structural
 * members) so they can be located too, not just flagged as damaged.
 *
 * Runs entirely on mock data (see data/mockDamageData.ts) — there is no detection
 * pipeline or backend call here yet. The `id` route param is accepted so this slots
 * into the existing job/[id]/* navigation, but nothing here reads real job state.
 */

import { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Button, Card } from '@/components/ui';
import { DamageCard } from '@/components/Damage/DamageCard';
import { DamageLegend } from '@/components/Damage/DamageLegend';
import { DamageToggle } from '@/components/Damage/DamageToggle';
import { ExplodedDiagram } from '@/components/Diagram/ExplodedDiagram';
import { PartBottomSheet } from '@/components/Parts/PartBottomSheet';
import { labelForMesh } from '@/components/VehicleViewer/carLayout';
import { VehicleViewer } from '@/components/VehicleViewer/VehicleViewer';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { mockDamageData } from '@/data/mockDamageData';

export default function InspectionViewerScreen() {
  const theme = useTheme();
  const params = useLocalSearchParams<{
    id: string;
    vehicleLabel?: string;
    assessment?: string;
  }>();

  const [showVisible, setShowVisible] = useState(true);
  const [showInvisible, setShowInvisible] = useState(false);
  const [selectedMeshName, setSelectedMeshName] = useState<string | null>(null);
  const [summaryVisible, setSummaryVisible] = useState(false);
  const [diagramVisible, setDiagramVisible] = useState(false);

  const activeRegions = useMemo(
    () =>
      mockDamageData.filter(
        (region) =>
          (region.damageType === 'visible' && showVisible) ||
          (region.damageType === 'invisible' && showInvisible),
      ),
    [showVisible, showInvisible],
  );

  const selectedRegion = selectedMeshName
    ? (activeRegions.find((r) => r.meshName === selectedMeshName) ?? null)
    : null;
  const selectedLabel = selectedMeshName ? labelForMesh(selectedMeshName) : '';

  // Every part is tappable, not just damaged ones — this is a locate-a-part tool
  // first. The sheet decides for itself whether there's damage detail to show.
  const selectPart = (meshName: string) => setSelectedMeshName(meshName);

  const closeSheet = () => setSelectedMeshName(null);

  const openFromSummary = (meshName: string) => {
    setSelectedMeshName(meshName);
    setSummaryVisible(false);
  };

  // The "AI sees what humans cannot" moment — surfaces the first time invisible
  // damage is toggled on and nothing is selected yet.
  const showInsightBanner = showInvisible && !selectedRegion && activeRegions.some((r) => r.damageType === 'invisible');

  return (
    <ThemedView style={styles.container}>
      <View style={[styles.header, { borderBottomColor: theme.border }]}>
        {/* The fallback is the demo vehicle, so this screen and the prediction
            flow name the same car when no params are passed. */}
        <ThemedText type="smallBold">{params.vehicleLabel ?? 'Toyota Yaris 2023 · QMN16'}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {params.assessment ?? 'Front-right collision assessment'}
        </ThemedText>
      </View>

      <View style={styles.viewerArea}>
        <VehicleViewer
          activeRegions={activeRegions}
          showInvisible={showInvisible}
          selectedMeshName={selectedMeshName}
          onSelectPart={selectPart}
        />

        <View style={styles.legendOverlay}>
          <DamageLegend />
        </View>

        {showInsightBanner ? (
          <View style={styles.insightBanner}>
            <Card>
              <ThemedText type="smallBold">AI Insight</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                The collision angle and bumper deformation indicate there may be damage behind
                the visible impact area. Tap a glowing part to see why.
              </ThemedText>
            </Card>
          </View>
        ) : null}
      </View>

      <View style={[styles.footer, { borderTopColor: theme.border }]}>
        <DamageToggle
          showVisible={showVisible}
          showInvisible={showInvisible}
          onToggleVisible={() => setShowVisible((v) => !v)}
          onToggleInvisible={() => setShowInvisible((v) => !v)}
        />
        <Button
          title={`Damage summary (${activeRegions.length})`}
          variant="secondary"
          onPress={() => setSummaryVisible(true)}
          disabled={activeRegions.length === 0}
          fullWidth
        />
      </View>

      <Modal visible={summaryVisible} animationType="slide" onRequestClose={() => setSummaryVisible(false)}>
        <ThemedView style={styles.container}>
          <View style={[styles.header, { borderBottomColor: theme.border }]}>
            <ThemedText type="smallBold">Damage summary</ThemedText>
            <Pressable onPress={() => setSummaryVisible(false)} accessibilityRole="button" hitSlop={12}>
              <ThemedText type="smallBold" style={{ color: theme.accent }}>
                Close
              </ThemedText>
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={styles.summaryList}>
            {activeRegions.map((region) => (
              <DamageCard
                key={region.meshName}
                region={region}
                onPress={() => openFromSummary(region.meshName)}
              />
            ))}
          </ScrollView>
        </ThemedView>
      </Modal>

      <PartBottomSheet
        meshName={selectedMeshName}
        label={selectedLabel}
        region={selectedRegion}
        visible={selectedMeshName !== null}
        onClose={closeSheet}
        onViewDiagram={() => setDiagramVisible(true)}
      />

      {selectedRegion ? (
        <ExplodedDiagram
          visible={diagramVisible}
          onClose={() => setDiagramVisible(false)}
          title={`${selectedRegion.partName} assembly`}
          parts={selectedRegion.parts}
          selectedPart={selectedRegion.parts[0]}
        />
      ) : null}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.six,
    paddingBottom: Spacing.two,
    gap: Spacing.half,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  viewerArea: { flex: 1 },
  legendOverlay: { position: 'absolute', top: Spacing.two, left: Spacing.three },
  insightBanner: { position: 'absolute', left: Spacing.three, right: Spacing.three, bottom: Spacing.three },
  footer: {
    padding: Spacing.three,
    gap: Spacing.two,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  summaryList: { padding: Spacing.three, gap: Spacing.two },
});
