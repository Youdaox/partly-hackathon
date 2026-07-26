/**
 * AI Damage Inspection Viewer — screen 4.
 *
 * A repairer's tool for locating and identifying parts on a vehicle first, and
 * seeing AI damage predictions second: every part on the car is tappable, whether
 * or not anything is wrong with it. Toggling "Invisible Damage" doubles as an
 * X-ray mode that reveals parts not visible from outside (engine, structural
 * members) so they can be located too, not just flagged as damaged.
 *
 * Driven by the same case the rest of the app uses — `useCase(caseId)` — so a
 * repairer who has been describing damage to the assistant lands on a viewer
 * that already agrees with it. `regionsFromReport` (lib/damage-regions.ts) does
 * the join between the report's real catalogue parts and this screen's ~20
 * hand-placed mesh regions.
 */

import { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Button, Card, ErrorNotice, Loading } from '@/components/ui';
import { DamageCard } from '@/components/Damage/DamageCard';
import { DamageLegend } from '@/components/Damage/DamageLegend';
import { DamageToggle } from '@/components/Damage/DamageToggle';
import { ExplodedDiagram } from '@/components/Diagram/ExplodedDiagram';
import { PartBottomSheet } from '@/components/Parts/PartBottomSheet';
import { labelForMesh } from '@/components/VehicleViewer/carLayout';
import { VehicleViewer } from '@/components/VehicleViewer/VehicleViewer';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useCase } from '@/hooks/use-case';
import { diagramImageUrl } from '@/lib/backend';
import { regionsFromReport } from '@/lib/damage-regions';
import type { RegionPart } from '@/types/damage';

export default function InspectionViewerScreen() {
  const theme = useTheme();
  const { id: caseId } = useLocalSearchParams<{ id: string }>();

  const kase = useCase(caseId ?? null);
  const regions = useMemo(() => regionsFromReport(kase.report), [kase.report]);

  const [showVisible, setShowVisible] = useState(true);
  const [showInvisible, setShowInvisible] = useState(false);
  const [selectedMeshName, setSelectedMeshName] = useState<string | null>(null);
  const [summaryVisible, setSummaryVisible] = useState(false);
  const [diagramPart, setDiagramPart] = useState<RegionPart | null>(null);

  const activeRegions = useMemo(
    () =>
      regions.filter(
        (region) =>
          (region.damageType === 'visible' && showVisible) ||
          (region.damageType === 'invisible' && showInvisible),
      ),
    [regions, showVisible, showInvisible],
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

  const vehicleTitle = kase.vehicle
    ? [kase.vehicle.year, kase.vehicle.make, kase.vehicle.model].filter(Boolean).join(' ') ||
      kase.vehicle.rego
    : 'Loading vehicle…';
  const impact = kase.report?.impact;
  const impactLabel = impact?.zone
    ? `${impact.zone}${impact.side && impact.side !== 'C' ? `-${impact.side}` : ''} collision`.replace(
        /^./,
        (c) => c.toUpperCase(),
      )
    : undefined;

  const slug = kase.vehicle?.slug ?? null;
  const diagramImage =
    diagramPart?.diagramAvailable && diagramPart.diagramId && slug
      ? { uri: diagramImageUrl(slug, diagramPart.diagramId) }
      : undefined;

  return (
    <ThemedView style={styles.container}>
      <View style={[styles.header, { borderBottomColor: theme.border }]}>
        <ThemedText type="smallBold">{vehicleTitle}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {impactLabel ?? 'Diagnosis'}
        </ThemedText>
      </View>

      {kase.loading ? (
        <Loading label="Loading the report…" />
      ) : kase.error && regions.length === 0 ? (
        <View style={styles.padded}>
          <ErrorNotice title={kase.error.title} detail={kase.error.detail} />
        </View>
      ) : (
        <>
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
        </>
      )}

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
        onSelectPart={setDiagramPart}
      />

      <ExplodedDiagram
        visible={diagramPart !== null}
        onClose={() => setDiagramPart(null)}
        title={diagramPart?.name ?? ''}
        parts={selectedRegion?.parts.map((p) => p.name) ?? []}
        selectedPart={diagramPart?.name}
        diagramImage={diagramImage}
      />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  padded: { padding: Spacing.three },
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
