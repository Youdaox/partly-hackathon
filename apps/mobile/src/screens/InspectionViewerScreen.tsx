/**
 * AI Damage Inspection Viewer — screen 4.
 *
 * A repairer's tool for locating and identifying parts on a vehicle first, and
 * seeing AI damage predictions second: every part on the car is tappable, whether
 * or not anything is wrong with it. Toggling "AI-predicted" doubles as an X-ray
 * mode that reveals parts not visible from outside (engine, structural members)
 * so they can be located too, not just flagged as damaged.
 *
 * Laid out as a fixed split rather than the viewer-plus-modal this used to be: the
 * 3D stage stays on screen at all times above a docked, always-visible parts list,
 * so tapping a row in the list highlights + focuses the camera on the matching part
 * right there above it instead of hiding that feedback behind a sheet. Tapping a
 * part on the car itself does the same thing in reverse — one `selectedMeshName`
 * drives both.
 *
 * Driven by the same case the rest of the app uses — `useCase(caseId)` — so a
 * repairer who has been describing damage to the assistant lands on a viewer
 * that already agrees with it. `regionsFromReport` (lib/damage-regions.ts) does
 * the join between the report's real catalogue parts and this screen's ~20
 * hand-placed mesh regions.
 */

import { useMemo, useState } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Card, EmptyState, ErrorNotice, Loading, SectionLabel } from '@/components/ui';
import { DamageCard } from '@/components/Damage/DamageCard';
import { DamageLegend } from '@/components/Damage/DamageLegend';
import { DamageToggle } from '@/components/Damage/DamageToggle';
import { ExplodedDiagram } from '@/components/Diagram/ExplodedDiagram';
import { PartBottomSheet } from '@/components/Parts/PartBottomSheet';
import { labelForMesh } from '@/components/VehicleViewer/carLayout';
import { VehicleViewer } from '@/components/VehicleViewer/VehicleViewer';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useCase } from '@/hooks/use-case';
import { diagramImageUrl } from '@/lib/backend';
import { regionsFromReport } from '@/lib/damage-regions';
import type { DamageRegion, RegionPart } from '@/types/damage';

export default function InspectionViewerScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { id: caseId } = useLocalSearchParams<{ id: string }>();

  const kase = useCase(caseId ?? null);
  const regions = useMemo(() => regionsFromReport(kase.report), [kase.report]);

  const [showVisible, setShowVisible] = useState(true);
  const [showInvisible, setShowInvisible] = useState(false);
  const [selectedMeshName, setSelectedMeshName] = useState<string | null>(null);
  const [diagramPart, setDiagramPart] = useState<RegionPart | null>(null);

  const visibleRegions = useMemo(() => regions.filter((r) => r.damageType === 'visible'), [regions]);
  const invisibleRegions = useMemo(() => regions.filter((r) => r.damageType === 'invisible'), [regions]);

  const activeRegions = useMemo(
    () => [...(showVisible ? visibleRegions : []), ...(showInvisible ? invisibleRegions : [])],
    [visibleRegions, invisibleRegions, showVisible, showInvisible],
  );

  const selectedRegion = selectedMeshName
    ? (activeRegions.find((r) => r.meshName === selectedMeshName) ?? null)
    : null;
  const selectedLabel = selectedMeshName ? labelForMesh(selectedMeshName) : '';

  // Every part is tappable, not just damaged ones — this is a locate-a-part tool
  // first. The sheet decides for itself whether there's damage detail to show.
  // Shared by a tap on the car and a tap on the list, so both highlight the same way.
  const selectPart = (meshName: string) => setSelectedMeshName(meshName);

  const closeSheet = () => setSelectedMeshName(null);

  // The "AI sees what humans cannot" moment — surfaces the first time invisible
  // damage is toggled on and nothing is selected yet.
  const showInsightBanner = showInvisible && !selectedRegion && invisibleRegions.length > 0;

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

  const emptyMessage =
    regions.length === 0
      ? 'No damage on this vehicle yet.'
      : !showVisible && !showInvisible
        ? 'Both filters are off — turn one on to see parts here.'
        : 'Nothing in this view. Try the other filter, or tap a part on the car.';

  return (
    <ThemedView style={styles.container}>
      <View style={styles.masthead}>
        <ThemedText type="section" style={styles.centred}>
          {vehicleTitle}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary" style={styles.centred}>
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
          <View style={[styles.stage, { shadowColor: theme.text }]}>
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

          <View style={styles.toggleRow}>
            <DamageToggle
              visibleCount={visibleRegions.length}
              invisibleCount={invisibleRegions.length}
              showVisible={showVisible}
              showInvisible={showInvisible}
              onToggleVisible={() => setShowVisible((v) => !v)}
              onToggleInvisible={() => setShowInvisible((v) => !v)}
            />
          </View>

          <View style={styles.listHeader}>
            <SectionLabel>DAMAGED PARTS</SectionLabel>
            <ThemedText type="small" themeColor="textSecondary">
              {activeRegions.length}
            </ThemedText>
          </View>

          <View
            style={[
              styles.listCard,
              { borderColor: theme.border, backgroundColor: theme.backgroundElement },
            ]}
          >
            <FlatList
              data={activeRegions}
              keyExtractor={(region: DamageRegion) => region.meshName}
              contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + Spacing.two }]}
              renderItem={({ item, index }) => (
                <DamageCard
                  region={item}
                  divider={index > 0}
                  selected={item.meshName === selectedMeshName}
                  onPress={() => selectPart(item.meshName)}
                />
              )}
              ListEmptyComponent={<EmptyState message={emptyMessage} />}
            />
          </View>
        </>
      )}

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
  masthead: {
    gap: 2,
    alignItems: 'center',
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.two,
  },
  centred: { textAlign: 'center' },

  // The 3D stage: a rounded dark "showroom" card floating in the light page rather
  // than a full-bleed rectangle butting straight up against it.
  stage: {
    flex: 1.15,
    marginHorizontal: Spacing.three,
    borderRadius: Radius.card,
    overflow: 'hidden',
    backgroundColor: '#14161A',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.12,
    shadowRadius: 16,
    elevation: 4,
  },
  legendOverlay: { position: 'absolute', top: Spacing.two, left: Spacing.two },
  insightBanner: { position: 'absolute', left: Spacing.two, right: Spacing.two, bottom: Spacing.two },

  toggleRow: { paddingHorizontal: Spacing.three, paddingTop: Spacing.three },

  listHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.three,
    paddingBottom: Spacing.one,
  },

  // The parts list: one card, matching the diagnosis report's grouped-list treatment
  // (case-report.tsx's `groupCard`) so the two screens read as the same app.
  listCard: {
    flex: 1,
    marginHorizontal: Spacing.three,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.card,
    overflow: 'hidden',
  },
  list: { flexGrow: 1 },
});
