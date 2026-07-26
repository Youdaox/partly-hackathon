/**
 * Screen A — the assessment, with the car beside the list.
 *
 * Composed entirely from `system/`: header, vehicle line, title, 3D panel,
 * tabs, question card, part cards, footer. Nothing here styles a component of
 * its own; if something needs a treatment this file cannot get from a
 * primitive, the primitive is what should change.
 *
 * No composer. This screen carried a follow-up box that posted a message
 * nothing acted on, and it cost more than it looked: its "+" was a second one
 * beside the header's, and its send arrow a second beside the footer's, so the
 * page offered two pluses and two arrows that did different things. The one
 * question worth asking is already on screen as the question card.
 *
 * The middle band is the only scrolling region. The panel and the tabs stay put
 * so the car and the filter never leave the screen while a repairer works down
 * the list.
 */

import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ErrorNotice, Loading } from '@/components/ui';
import { Faces, Intake } from '@/constants/theme';
import { diagramImageUrl } from '@/lib/backend';
import { regionsFromReport } from '@/lib/damage-regions';
import type { CaseReport, ReportLine, VehiclePayload } from '@/lib/backend';
import type { ErrorInfo } from '@/hooks/use-case';
import { useCascade } from '@/hooks/use-cascade';
import { InspectionPanel } from './inspection-panel';
import { FooterBar, PageTitle, Rule, ScreenHeader, VehicleLine } from './primitives';
import { PartCard, QuestionCard, SegmentedTabs } from './report-parts';

type TabKey = 'confirmed' | 'predicted';

/**
 * Why a part carries the number it does, in one line.
 *
 * `attribution` is the engine's own decomposition — each cause's share of the
 * log-odds, summing to 1 — so printing the top two is the difference between a
 * repairer reading 88% as a figure the app produced and reading it as one with
 * parts he can check.
 */
function reasoning(line: ReportLine): string {
  const causes = line.attribution ?? [];
  if (causes.length === 0) return '';
  return causes
    .slice(0, 2)
    .map((cause) => {
      const share = Math.round(cause.share * 100);
      if (cause.relation === 'root') return `${share}% impact zone`;
      if (cause.relation === 'leak') return `${share}% base rate`;
      if (cause.relation === 'observation') return 'seen in the photos';
      if (cause.relation === 'confirmed') return 'confirmed at the car';
      return `${share}% ${cause.cause}`;
    })
    .join(' · ');
}

/** "front-both sides" from the impact, in the words on the mock. */
function collisionDescriptor(report: CaseReport): string {
  const zone = report.impact?.zone ?? '';
  const side = report.impact?.side;
  const where =
    side === 'both' ? 'both sides' : side === 'L' ? 'left' : side === 'R' ? 'right' : 'centre';
  return zone ? `${zone.charAt(0).toUpperCase()}${zone.slice(1)}-${where}` : '';
}

export interface ResultsScreenProps {
  report: CaseReport | null;
  loading: boolean;
  vehicle: VehiclePayload | null;
  error: ErrorInfo | null;
  busyId: string | null;
  answering: string | null;
  onConfirm: (partId: string, damaged: boolean | null) => void;
  onAnswer: (questionId: string, value: string) => void;
  onBack: () => void;
  onNewAssessment: () => void;
  onReviewAndConfirm: () => void;
}

export function ResultsScreen({
  report,
  loading,
  vehicle,
  error,
  busyId,
  answering,
  onConfirm,
  onAnswer,
  onBack,
  onNewAssessment,
  onReviewAndConfirm,
}: ResultsScreenProps) {
  const [tab, setTab] = useState<TabKey>('predicted');
  const [selectedMesh, setSelectedMesh] = useState<string | null>(null);
  /** One diagram open at a time — two 180px images at once buries the list. */
  const [openDiagram, setOpenDiagram] = useState<string | null>(null);

  const regions = useMemo(() => regionsFromReport(report), [report]);

  /** What the last answer or tick moved, so the screen can point at it. */
  const cascade = useCascade(report);

  /**
   * part_id -> the mesh it sits on.
   *
   * `regionsFromReport` already grouped every placeable line onto a mesh, so this inverts
   * that rather than repeating the klass/side/zone mapping. Parts with no `klass` — hardware
   * and consumables never carry one — are absent, which is what leaves their cards inert
   * instead of selecting the wrong panel.
   */
  const meshByPart = useMemo(() => {
    const index = new Map<string, string>();
    for (const region of regions) {
      for (const part of region.parts) {
        if (!index.has(part.partId)) index.set(part.partId, region.meshName);
      }
    }
    return index;
  }, [regions]);

  const groups = useMemo(() => {
    if (!report) return { confirmed: [] as ReportLine[], predicted: [] as ReportLine[] };
    const ticked = (line: ReportLine) => line.confirmed != null;
    return {
      confirmed: [
        ...report.sections.visible,
        ...report.sections.order.filter(ticked),
        ...report.sections.check.filter(ticked),
      ],
      predicted: [
        ...report.sections.order.filter((line) => !ticked(line)),
        ...report.sections.check.filter((line) => !ticked(line)),
      ],
    };
  }, [report]);

  if (!report) {
    return (
      <View style={styles.page}>
        <ScreenHeader onBack={onBack} backLabel="Back to adding damage" />
        <View style={styles.pending}>
          {loading ? (
            <Loading label="Running the prediction…" />
          ) : (
            <ErrorNotice title={error?.title ?? 'No prediction yet'} detail={error?.detail} />
          )}
        </View>
      </View>
    );
  }

  const active = tab === 'confirmed' ? groups.confirmed : groups.predicted;
  const flagged = groups.confirmed.length + groups.predicted.length;

  return (
    <View style={styles.page}>
      <ScreenHeader
        onBack={onBack}
        backLabel="Back to adding damage"
        onAction={onNewAssessment}
        actionLabel="Start another assessment"
      />

      <View style={styles.context}>
        <VehicleLine
          name={[vehicle?.year, vehicle?.make, vehicle?.model].filter(Boolean).join(' ')}
          plate={vehicle?.rego}
          meta={
            vehicle?.parts_indexed
              ? `${vehicle.parts_indexed.toLocaleString()} parts`
              : null
          }
        />
        <Rule />

        <View style={styles.titleRow}>
          <PageTitle size={30} style={styles.title}>
            {`${flagged} parts flagged`}
          </PageTitle>
          <ThemedText style={styles.descriptor}>{collisionDescriptor(report)}</ThemedText>
        </View>

        <InspectionPanel
          regions={regions}
          showInvisible={tab === 'predicted'}
          selectedMeshName={selectedMesh}
          onSelectPart={setSelectedMesh}
          showInsight={tab === 'predicted'}
        />

        <SegmentedTabs
          tabs={[
            { key: 'confirmed', label: 'Confirmed', count: groups.confirmed.length },
            { key: 'predicted', label: 'AI-predicted', count: groups.predicted.length },
          ]}
          active={tab}
          onSelect={setTab}
        />
      </View>

      {/* The only scrolling region. `flex: 1` + `minHeight: 0` is what stops a
          long list being clipped below the composer instead of scrolling. */}
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollBody}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {error ? <ErrorNotice title={error.title} detail={error.detail} /> : null}

        {report.question ? (
          <QuestionCard
            question={report.question.text}
            options={report.question.options}
            answering={answering}
            onAnswer={(option) => onAnswer(report.question!.id, option)}
          />
        ) : null}

        {/* The totals, because the rows that moved may be below the fold — and because
            answering the side question mostly swaps parts rather than moving them, which
            no per-row marker can show on its own. */}
        {cascade.active ? (
          <View style={styles.cascade}>
            <ThemedText style={styles.cascadeText}>
              {[
                cascade.arrived.size > 0 ? `${cascade.arrived.size} new` : null,
                cascade.changes.size > 0 ? `${cascade.changes.size} re-ranked` : null,
                cascade.departed > 0 ? `${cascade.departed} no longer likely` : null,
              ]
                .filter(Boolean)
                .join('  ·  ')}
            </ThemedText>
          </View>
        ) : null}

        {active.length === 0 ? (
          <ThemedText style={styles.empty}>
            {tab === 'confirmed' ? 'Nothing confirmed yet.' : 'Nothing else predicted.'}
          </ThemedText>
        ) : (
          active.map((line) => {
            const mesh = meshByPart.get(line.part_id) ?? null;
            return (
            <PartCard
              key={line.part_id}
              name={line.name}
              p={line.p}
              reasoning={reasoning(line)}
              confirmed={line.confirmed != null || tab === 'confirmed'}
              busy={busyId === line.part_id}
              // Tapping the card lights this part's mesh on the model above; tapping it
              // again clears, so the same gesture is the way back out.
              onPress={
                mesh
                  ? () => setSelectedMesh((current) => (current === mesh ? null : mesh))
                  : undefined
              }
              selected={mesh != null && mesh === selectedMesh}
              // A moved or newly arrived row says so, and says what it moved from.
              moved={cascade.changes.has(line.part_id) || cascade.arrived.has(line.part_id)}
              changedFrom={cascade.changes.get(line.part_id)?.from}
              isNew={cascade.arrived.has(line.part_id)}
              onConfirm={tab === 'confirmed' ? undefined : () => onConfirm(line.part_id, true)}
              // `false` is "I looked, it is fine" — the engine clamps it to zero and drops
              // the part from the report entirely. Available on both tabs: a confirmed row
              // needs it most, since otherwise a wrong call reaches the customer's quote.
              onRemove={() => onConfirm(line.part_id, false)}
              // Only a fraction of diagrams ship an image; the rest have no
              // toggle rather than a toggle that opens nothing.
              diagramUrl={
                line.diagram_available && line.diagram_id && vehicle?.slug
                  ? diagramImageUrl(vehicle.slug, line.diagram_id)
                  : null
              }
              diagramOpen={openDiagram === line.part_id}
              onToggleDiagram={() =>
                setOpenDiagram((current) => (current === line.part_id ? null : line.part_id))
              }
            />
          );
        })
        )}
      </ScrollView>

      {/* No label: the action already says what it does, and "Full parts list" beside it
          read as a second button that went nowhere. */}
      <FooterBar
        action={`Review & confirm list (${groups.predicted.length}) →`}
        onPress={onReviewAndConfirm}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: Intake.page },
  pending: { padding: Intake.gutter, gap: 16 },

  // Tight to the header. Losing the duplicate nav bar gave this screen its
  // height back, and the car is what should get it — the panel is the part a
  // repairer reads at a glance, and it was sitting below the fold.
  context: { paddingTop: 10, paddingHorizontal: Intake.gutter, gap: 11 },
  titleRow: { flexDirection: 'row', alignItems: 'baseline', gap: 12 },
  title: { flex: 1 },
  descriptor: { fontFamily: Faces.sans, fontSize: 12, color: Intake.mutedLabel },

  scroll: { flex: 1, minHeight: 0 },
  scrollBody: { paddingTop: 14, paddingHorizontal: Intake.gutter, gap: 12, paddingBottom: 8 },
  cascade: {
    backgroundColor: Intake.accentPale,
    borderLeftWidth: 2,
    borderLeftColor: Intake.accent,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  cascadeText: { fontFamily: Faces.sansMedium, fontSize: 12.5, color: Intake.accentPaleText },
  empty: { fontFamily: Faces.sans, fontSize: 13, color: Intake.mutedLabel },

});
