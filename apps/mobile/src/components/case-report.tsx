/**
 * The diagnosis itself: everything the prediction backend returns for a case.
 *
 * Rendered inline on the entry screen and by the `/case/[id]` deep link, so there is one
 * implementation. Scrolls; the composer sits below it and is the caller's business.
 *
 * There is deliberately no vehicle silhouette here. The impact zone is stated in words on
 * the status line instead — a drawing of a car that cannot show left from right on a side
 * profile was decoration, and it pushed the actual parts list below the fold.
 */

import { Fragment } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Framed } from '@/components/framed';
import { ThemedText } from '@/components/themed-text';
import {
  EmptyState,
  ErrorNotice,
  Loading,
  MatchBadge,
  NumberBadge,
  SectionLabel,
} from '@/components/ui';
import { Radius, Spacing, TapTarget } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { ErrorInfo } from '@/hooks/use-case';
import type { CaseReport, ReportLine, VehiclePayload } from '@/lib/backend';

/** The backend's `impact.side` code, in the repairer's words. */
function sideLabel(side: string | null | undefined): string | null {
  if (!side) return null;
  switch (side.toUpperCase()) {
    case 'R':
      return 'right';
    case 'L':
      return 'left';
    case 'C':
      return 'centre';
    case 'B':
    case 'BOTH':
      return 'both sides';
    default:
      return side;
  }
}

/** Track A progress, in the repairer's words rather than the schema's. */
function vehicleStatusLine(vehicle: VehiclePayload | null): string {
  if (!vehicle) return 'Looking up the vehicle…';
  switch (vehicle.status) {
    case 'resolving':
      return `Looking up ${vehicle.rego}…`;
    case 'catalogue_ready': {
      const name = [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(' ');
      return `${name} · ${vehicle.parts_indexed?.toLocaleString()} parts ready`;
    }
    case 'no_catalogue':
      return `${vehicle.rego} has no parts catalogue — claims stay class-level`;
    case 'not_found':
      return `${vehicle.rego} not found`;
    default:
      return vehicle.status;
  }
}

/** "front, right · severity 3/3", or null when the backend has not called it yet. */
function impactLine(report: CaseReport): string | null {
  if (!report.impact?.zone) return null;
  const side = sideLabel(report.impact.side);
  const severity = report.impact.severity != null ? ` · severity ${report.impact.severity}/3` : '';
  return `${report.impact.zone}${side ? `, ${side}` : ''}${severity}`;
}

export interface CaseReportViewProps {
  report: CaseReport | null;
  loading: boolean;
  vehicle: VehiclePayload | null;
  error: ErrorInfo | null;
  said?: string;
  busyId: string | null;
  answering: string | null;
  /** Which check row has its attribution open. */
  expanded: string | null;
  onToggleExpanded: (partId: string | null) => void;
  onConfirm: (partId: string, damaged: boolean) => void;
  onAnswer: (questionId: string, value: string) => void;
  /** Rendered under the last section, e.g. a Send-to-customer button. */
  footer?: React.ReactNode;
}

export function CaseReportView({
  report,
  loading,
  vehicle,
  error,
  said,
  busyId,
  answering,
  expanded,
  onToggleExpanded,
  onConfirm,
  onAnswer,
  footer,
}: CaseReportViewProps) {
  const theme = useTheme();

  const resolving = vehicle?.status === 'resolving';

  /**
   * The pill reports Track A and must be visible *before* there is a report — watching the
   * catalogue load is the point of it, so it cannot sit behind a spinner.
   */
  const statusPill = (
    <View style={[styles.statusPill, { backgroundColor: theme.badgeFill }]}>
      <Ionicons
        name={resolving ? 'ellipsis-horizontal-circle-outline' : 'checkmark-circle'}
        size={16}
        color={theme.badgeText}
      />
      <ThemedText type="small" style={[styles.statusText, { color: theme.badgeText }]}>
        {vehicleStatusLine(vehicle)}
      </ThemedText>
      {vehicle?.resolved_ms ? (
        <ThemedText type="small" themeColor="textSecondary">
          {vehicle.resolved_ms} ms
        </ThemedText>
      ) : null}
    </View>
  );

  if (!report) {
    return (
      <View style={styles.pending}>
        {statusPill}
        {loading ? (
          <Loading label={resolving ? 'Loading the catalogue…' : 'Running the prediction…'} />
        ) : (
          <ErrorNotice title={error?.title ?? 'No prediction yet'} detail={error?.detail} />
        )}
        {loading && error ? <ErrorNotice title={error.title} detail={error.detail} /> : null}
      </View>
    );
  }
  const impact = impactLine(report);

  /** A line in the see/order sections: no confirm, no attribution. */
  const plainLine = (line: ReportLine, index: number) => (
    <View
      key={line.part_id}
      style={[styles.card, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}
    >
      <View style={styles.rowHead}>
        <NumberBadge n={index + 1} muted />
        <ThemedText type="rowTitle" style={styles.rowName}>
          {line.name}
        </ThemedText>
        <MatchBadge value={line.p} />
      </View>

      <View style={styles.metaRow}>
        {line.part_number ? (
          <ThemedText type="small" themeColor="textSecondary" style={styles.partNumber}>
            {line.part_number}
          </ThemedText>
        ) : null}
        {line.qty > 1 ? (
          <ThemedText type="smallBold" style={{ color: theme.badgeText }}>
            ×{line.qty}
          </ThemedText>
        ) : null}
      </View>

      {line.reason ? (
        <ThemedText type="small" themeColor="textSecondary">
          {line.reason}
        </ThemedText>
      ) : null}
    </View>
  );

  return (
    <ScrollView contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled">
      {/* Track A progress. Never blocks anything below it. */}
      {statusPill}

      {impact ? (
        <ThemedText type="small" themeColor="textSecondary" style={styles.impact}>
          Impact: {impact}
        </ThemedText>
      ) : null}

      {said ? (
        <View style={styles.saidBlock}>
          <View style={[styles.saidChip, { borderColor: theme.accent }]}>
            <ThemedText type="small" style={{ color: theme.accent }}>
              You said
            </ThemedText>
          </View>
          <ThemedText>{said}</ThemedText>
        </View>
      ) : null}

      {error ? <ErrorNotice title={error.title} detail={error.detail} /> : null}

      {report.degraded ? (
        <ErrorNotice
          title="No parts catalogue for this vehicle"
          detail="The assistant can still describe the damage, but cannot name orderable parts."
        />
      ) : null}

      {/* --- The one clarifying question ------------------------------------- */}
      {report.question ? (
        <Framed style={[styles.questionCard, { borderColor: theme.accent }]}>
          <SectionLabel>ONE QUESTION</SectionLabel>
          <ThemedText type="rowTitle">{report.question.text}</ThemedText>
          <View style={styles.chips}>
            {report.question.options.map((option) => (
              <Pressable
                key={option}
                accessibilityRole="button"
                disabled={answering !== null}
                onPress={() => onAnswer(report.question!.id, option)}
                style={({ pressed }) => [
                  styles.chip,
                  {
                    borderColor: theme.accent,
                    backgroundColor: answering === option ? theme.badgeFill : 'transparent',
                    opacity: pressed ? 0.6 : 1,
                  },
                ]}
              >
                <ThemedText type="smallBold" style={{ color: theme.accent }}>
                  {option}
                </ThemedText>
              </Pressable>
            ))}
          </View>
          <ThemedText type="small" themeColor="textSecondary">
            Asked because answering moves the report more than anything else
            {` (${report.question.value.toFixed(1)})`}.
          </ThemedText>
        </Framed>
      ) : null}

      {/* --- ✓ You can see these -------------------------------------------- */}
      <View style={styles.sectionHead}>
        <ThemedText type="section">You can see these</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {report.sections.visible.length} parts
        </ThemedText>
      </View>
      {report.sections.visible.length === 0 ? (
        <EmptyState message="Nothing recorded as visible yet." />
      ) : (
        report.sections.visible.map(plainLine)
      )}

      {/* --- + You'll also need these --------------------------------------- */}
      <View style={styles.sectionHead}>
        <ThemedText type="section">You&apos;ll also need these</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {report.sections.order.length} parts
        </ThemedText>
      </View>
      {report.sections.order.length === 0 ? (
        <EmptyState message="Nothing else implied yet." />
      ) : (
        report.sections.order.map(plainLine)
      )}

      {/* --- ? Check these when it comes apart ------------------------------- */}
      <View style={styles.sectionHead}>
        <ThemedText type="section">Check these when it&apos;s off</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {report.sections.check.length} to look at
        </ThemedText>
      </View>

      {report.sections.check.map((line) => {
        const open = expanded === line.part_id;
        return (
          <View
            key={line.part_id}
            style={[
              styles.card,
              { backgroundColor: theme.backgroundElement, borderColor: theme.border },
            ]}
          >
            <View style={styles.rowHead}>
              {line.inspection_rank != null ? <NumberBadge n={line.inspection_rank} /> : null}
              <ThemedText type="rowTitle" style={styles.rowName}>
                {line.name}
              </ThemedText>
              <MatchBadge value={line.p} />
            </View>

            <View style={styles.metaRow}>
              {line.part_number ? (
                <ThemedText type="small" themeColor="textSecondary" style={styles.partNumber}>
                  {line.part_number}
                </ThemedText>
              ) : null}
              {line.qty > 1 ? (
                <ThemedText type="smallBold" style={{ color: theme.badgeText }}>
                  ×{line.qty}
                </ThemedText>
              ) : null}
              {line.accessible === false ? (
                <ThemedText type="small" style={{ color: theme.warning }}>
                  needs teardown
                </ThemedText>
              ) : null}
            </View>

            {line.reason ? (
              <ThemedText type="small" themeColor="textSecondary">
                {line.reason}
              </ThemedText>
            ) : null}

            {/* Attribution: the exact decomposition behind the number. */}
            {line.attribution?.length ? (
              <Fragment>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => onToggleExpanded(open ? null : line.part_id)}
                  style={({ pressed }) => [styles.whyToggle, { opacity: pressed ? 0.6 : 1 }]}
                >
                  <Ionicons
                    name={open ? 'chevron-up' : 'chevron-down'}
                    size={15}
                    color={theme.accent}
                  />
                  <ThemedText type="smallBold" style={{ color: theme.accent }}>
                    {open ? 'Hide why' : 'Why'}
                  </ThemedText>
                </Pressable>

                {open ? (
                  <View style={styles.attribution}>
                    {line.attribution.map((cause, i) => (
                      <View key={`${line.part_id}-${i}`} style={styles.causeRow}>
                        <ThemedText type="small" style={styles.causeName} numberOfLines={2}>
                          {cause.cause}
                        </ThemedText>
                        <ThemedText type="small" themeColor="textSecondary">
                          {cause.relation.replace(/_/g, ' ')}
                        </ThemedText>
                        <ThemedText type="smallBold" style={{ color: theme.badgeText }}>
                          {Math.round(cause.share * 100)}%
                        </ThemedText>
                      </View>
                    ))}
                  </View>
                ) : null}
              </Fragment>
            ) : null}

            {/* ✓ / ✗ are the only interaction: two taps, greasy hands. */}
            {line.confirmed == null ? (
              <View style={styles.answerRow}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Confirm ${line.name} is damaged`}
                  disabled={busyId === line.part_id}
                  onPress={() => onConfirm(line.part_id, true)}
                  style={({ pressed }) => [
                    styles.answerButton,
                    { borderColor: theme.success, opacity: pressed ? 0.6 : 1 },
                  ]}
                >
                  <Ionicons name="checkmark" size={20} color={theme.success} />
                  <ThemedText type="smallBold" style={{ color: theme.success }}>
                    Damaged
                  </ThemedText>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Rule out ${line.name}`}
                  disabled={busyId === line.part_id}
                  onPress={() => onConfirm(line.part_id, false)}
                  style={({ pressed }) => [
                    styles.answerButton,
                    { borderColor: theme.border, opacity: pressed ? 0.6 : 1 },
                  ]}
                >
                  <Ionicons name="close" size={20} color={theme.textSecondary} />
                  <ThemedText type="smallBold" themeColor="textSecondary">
                    Not damaged
                  </ThemedText>
                </Pressable>
              </View>
            ) : (
              <View style={styles.reviewedRow}>
                <Ionicons
                  name={line.confirmed ? 'checkmark-circle' : 'close-circle-outline'}
                  size={18}
                  color={line.confirmed ? theme.success : theme.textSecondary}
                />
                <ThemedText
                  type="small"
                  style={{ color: line.confirmed ? theme.success : theme.textSecondary }}
                >
                  {line.confirmed ? 'Confirmed damaged' : 'Ruled out'}
                </ThemedText>
              </View>
            )}
          </View>
        );
      })}

      {/* What the engine actually did, so the numbers are not a black box. */}
      {report.hidden_count != null ? (
        <ThemedText type="small" themeColor="textSecondary" style={styles.footnote}>
          {report.hidden_count.toLocaleString()} hidden parts scored from{' '}
          {report.candidates?.toLocaleString()} candidates in {report.computed_ms} ms.
        </ThemedText>
      ) : null}

      {footer}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  pending: { padding: Spacing.three, gap: Spacing.three },
  // Tighter than the old crop-marked layout: cards carry their own edges, so they need
  // less air between them. Section headings buy the separation back with padding.
  list: { padding: Spacing.three, gap: Spacing.three, paddingBottom: Spacing.five },

  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderRadius: Radius.round,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  statusText: { flex: 1, fontWeight: '600' },
  impact: { marginTop: -Spacing.three },

  saidBlock: { gap: Spacing.two },
  saidChip: {
    alignSelf: 'flex-start',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.chip,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.half,
  },

  questionCard: { gap: Spacing.two, borderLeftWidth: 2, paddingLeft: Spacing.three },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two, marginTop: Spacing.one },
  chip: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.chip,
    paddingHorizontal: Spacing.three,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },

  sectionHead: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: Spacing.two,
    paddingTop: Spacing.three,
  },

  /**
   * A part row is a solid card, not a crop-marked frame: the sections stack a dozen of
   * these and the registration ticks read as clutter at that density.
   */
  card: {
    gap: Spacing.two,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.card - 4,
    padding: Spacing.three,
  },
  rowHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  rowName: { flex: 1 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, flexWrap: 'wrap' },
  partNumber: { fontSize: 12 },

  whyToggle: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one, minHeight: 32 },
  attribution: { gap: Spacing.one },
  causeRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  causeName: { flex: 1 },

  answerRow: { flexDirection: 'row', gap: Spacing.two, marginTop: Spacing.one },
  answerButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.one,
    minHeight: TapTarget - 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.prompt,
  },
  reviewedRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, minHeight: 32 },

  footnote: { textAlign: 'center' },
});
