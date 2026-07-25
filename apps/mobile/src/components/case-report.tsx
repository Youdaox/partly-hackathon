/**
 * The assistant's answer: everything the prediction backend returns for a case.
 *
 * Renders as a plain `View`, not a scroll container — it lives inside the chat thread on the
 * home screen, so the thread owns scrolling. Wrapping it in its own ScrollView would nest
 * two of them and break the thread.
 *
 * Styling is deliberately flat: no card borders or fills, just type weight and hairline
 * dividers, the way a message list reads. The only filled surface in the whole thread is the
 * repairer's own message bubble.
 */

import { Fragment, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { ThemedText } from '@/components/themed-text';
import { EmptyState, ErrorNotice, Loading, MatchBadge, SectionLabel } from '@/components/ui';
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
      return `${name} · ${vehicle.parts_indexed?.toLocaleString()} parts`;
    }
    case 'no_catalogue':
      return `${vehicle.rego} has no parts catalogue`;
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

// ---------------------------------------------------------------------------

/** The repairer's own message, right-aligned. The one filled surface in the thread. */
export function MessageBubble({ text }: { text: string }) {
  const theme = useTheme();
  return (
    <View style={styles.bubbleRow}>
      <View style={[styles.bubble, { backgroundColor: theme.backgroundSelected }]}>
        <ThemedText>{text}</ThemedText>
      </View>
    </View>
  );
}

type SectionKey = 'visible' | 'order' | 'check';

const SECTIONS: { key: SectionKey; title: string }[] = [
  { key: 'visible', title: 'Visible damage' },
  { key: 'order', title: 'Hidden damage — order now' },
  { key: 'check', title: 'Parts to check if damaged' },
];

/**
 * A collapsed section header: a tappable row, not a box.
 *
 * The count is the summary, so all three groups are legible at a glance with none of the
 * rows on screen.
 */
function SectionBar({
  title,
  count,
  open,
  onPress,
}: {
  title: string;
  count: number;
  open: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ expanded: open }}
      accessibilityLabel={`${title}, ${count}`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.sectionBar,
        { borderBottomColor: theme.border, opacity: pressed ? 0.6 : 1 },
      ]}
    >
      <ThemedText type="rowTitle" style={styles.grow}>
        {title}
      </ThemedText>
      <ThemedText type="smallBold" style={{ color: theme.textSecondary }}>
        {count}
      </ThemedText>
      <Ionicons
        name={open ? 'chevron-down' : 'chevron-forward'}
        size={16}
        color={theme.textSecondary}
      />
    </Pressable>
  );
}

export interface CaseReportViewProps {
  report: CaseReport | null;
  loading: boolean;
  vehicle: VehiclePayload | null;
  error: ErrorInfo | null;
  busyId: string | null;
  answering: string | null;
  /** Which check row has its attribution open. */
  expanded: string | null;
  onToggleExpanded: (partId: string | null) => void;
  onConfirm: (partId: string, damaged: boolean) => void;
  onAnswer: (questionId: string, value: string) => void;
}

export function CaseReportView({
  report,
  loading,
  vehicle,
  error,
  busyId,
  answering,
  expanded,
  onToggleExpanded,
  onConfirm,
  onAnswer,
}: CaseReportViewProps) {
  const theme = useTheme();

  /**
   * Which section is expanded. `check` on arrival: it is the only one that asks the repairer
   * for anything, and the other two are summarised by their counts until wanted.
   */
  const [openSection, setOpenSection] = useState<SectionKey | null>('check');
  const toggleSection = (key: SectionKey) =>
    setOpenSection((current) => (current === key ? null : key));

  const resolving = vehicle?.status === 'resolving';

  /** Track A, as one quiet line. Visible before the report exists — that is the point. */
  const status = (
    <View style={styles.statusRow}>
      {resolving ? (
        <Ionicons name="ellipsis-horizontal" size={14} color={theme.textSecondary} />
      ) : null}
      <ThemedText type="small" themeColor="textSecondary">
        {vehicleStatusLine(vehicle)}
      </ThemedText>
    </View>
  );

  if (!report) {
    return (
      <View style={styles.pending}>
        {status}
        {loading ? (
          <Loading label={resolving ? 'Loading the catalogue…' : 'Working it out…'} />
        ) : (
          <ErrorNotice title={error?.title ?? 'No prediction yet'} detail={error?.detail} />
        )}
      </View>
    );
  }

  const impact = impactLine(report);

  /**
   * A row in the visible/hidden groups.
   *
   * The part number shows only on the order group — that group *is* the shopping list, so
   * the number is the point of it. On a part you are standing in front of it was 24
   * characters of noise.
   */
  const plainRow = (line: ReportLine, showPartNumber: boolean) => (
    <View key={line.part_id} style={[styles.row, { borderBottomColor: theme.border }]}>
      <View style={styles.rowHead}>
        <ThemedText type="rowTitle" style={styles.grow} numberOfLines={2}>
          {line.name}
          {line.qty > 1 ? (
            <ThemedText type="smallBold" style={{ color: theme.textSecondary }}>
              {'  '}×{line.qty}
            </ThemedText>
          ) : null}
        </ThemedText>
        <MatchBadge value={line.p} />
      </View>

      {line.reason ? (
        <ThemedText type="small" themeColor="textSecondary">
          {line.reason}
        </ThemedText>
      ) : null}

      {showPartNumber && line.part_number ? (
        <ThemedText type="small" themeColor="textSecondary" style={styles.partNumber}>
          {line.part_number}
        </ThemedText>
      ) : null}
    </View>
  );

  const rowsFor = (key: SectionKey) => {
    if (key === 'visible') {
      return report.sections.visible.length === 0 ? (
        <EmptyState message="Nothing recorded as visible yet." />
      ) : (
        report.sections.visible.map((line) => plainRow(line, false))
      );
    }
    if (key === 'order') {
      return report.sections.order.length === 0 ? (
        <EmptyState message="Nothing else implied yet." />
      ) : (
        report.sections.order.map((line) => plainRow(line, true))
      );
    }

    return report.sections.check.map((line) => {
      const open = expanded === line.part_id;
      return (
        <View key={line.part_id} style={[styles.row, { borderBottomColor: theme.border }]}>
          <View style={styles.rowHead}>
            <ThemedText type="rowTitle" style={styles.grow} numberOfLines={2}>
              {line.name}
              {line.qty > 1 ? (
                <ThemedText type="smallBold" style={{ color: theme.textSecondary }}>
                  {'  '}×{line.qty}
                </ThemedText>
              ) : null}
            </ThemedText>
            <MatchBadge value={line.p} />
          </View>

          {line.reason ? (
            <ThemedText type="small" themeColor="textSecondary">
              {line.reason}
            </ThemedText>
          ) : null}

          {line.accessible === false ? (
            <ThemedText type="small" style={{ color: theme.warning }}>
              needs teardown to see
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
                <ThemedText type="smallBold" style={{ color: theme.accent }}>
                  {open ? 'Hide why' : 'Why'}
                </ThemedText>
                <Ionicons
                  name={open ? 'chevron-up' : 'chevron-down'}
                  size={14}
                  color={theme.accent}
                />
              </Pressable>

              {open ? (
                <View style={styles.attribution}>
                  {line.attribution.map((cause, i) => (
                    <View key={`${line.part_id}-${i}`} style={styles.causeRow}>
                      <ThemedText type="small" style={styles.grow} numberOfLines={2}>
                        {cause.cause}
                      </ThemedText>
                      <ThemedText type="small" themeColor="textSecondary">
                        {cause.relation.replace(/_/g, ' ')}
                      </ThemedText>
                      <ThemedText type="smallBold" style={{ color: theme.textSecondary }}>
                        {Math.round(cause.share * 100)}%
                      </ThemedText>
                    </View>
                  ))}
                  {line.part_number ? (
                    <ThemedText type="small" themeColor="textSecondary" style={styles.partNumber}>
                      {line.part_number}
                    </ThemedText>
                  ) : null}
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
                <Ionicons name="checkmark" size={18} color={theme.success} />
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
                <Ionicons name="close" size={18} color={theme.textSecondary} />
                <ThemedText type="smallBold" themeColor="textSecondary">
                  Not damaged
                </ThemedText>
              </Pressable>
            </View>
          ) : (
            <View style={styles.reviewedRow}>
              <Ionicons
                name={line.confirmed ? 'checkmark-circle' : 'close-circle-outline'}
                size={16}
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
    });
  };

  const countFor = (key: SectionKey) => report.sections[key].length;

  return (
    <View style={styles.answer}>
      {status}
      {impact ? (
        <ThemedText type="small" themeColor="textSecondary">
          {impact}
        </ThemedText>
      ) : null}

      {error ? <ErrorNotice title={error.title} detail={error.detail} /> : null}

      {report.degraded ? (
        <ErrorNotice
          title="No parts catalogue for this vehicle"
          detail="The assistant can still describe the damage, but cannot name orderable parts."
        />
      ) : null}

      {/* The one clarifying question. Left rule rather than a box. */}
      {report.question ? (
        <View style={[styles.question, { borderLeftColor: theme.accent }]}>
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
        </View>
      ) : null}

      <View style={styles.sections}>
        {SECTIONS.map(({ key, title }) => (
          <Fragment key={key}>
            <SectionBar
              title={title}
              count={countFor(key)}
              open={openSection === key}
              onPress={() => toggleSection(key)}
            />
            {openSection === key ? rowsFor(key) : null}
          </Fragment>
        ))}
      </View>

    </View>
  );
}

const styles = StyleSheet.create({
  answer: { gap: Spacing.two },
  pending: { gap: Spacing.three, paddingVertical: Spacing.three },
  grow: { flex: 1 },

  bubbleRow: { alignItems: 'flex-end' },
  bubble: {
    maxWidth: '85%',
    borderRadius: Radius.card + 4,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },

  statusRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },

  question: {
    gap: Spacing.two,
    borderLeftWidth: 2,
    paddingLeft: Spacing.three,
    paddingVertical: Spacing.one,
    marginVertical: Spacing.two,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  chip: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.chip,
    paddingHorizontal: Spacing.three,
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },

  sections: { marginTop: Spacing.two },
  sectionBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    minHeight: TapTarget - 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },

  row: {
    gap: Spacing.one,
    paddingVertical: Spacing.three,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  partNumber: { fontSize: 12 },

  whyToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    minHeight: 30,
    alignSelf: 'flex-start',
  },
  attribution: { gap: Spacing.one, paddingBottom: Spacing.one },
  causeRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },

  answerRow: { flexDirection: 'row', gap: Spacing.two, marginTop: Spacing.one },
  answerButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.one,
    minHeight: 44,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.chip,
  },
  reviewedRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, minHeight: 30 },
});
