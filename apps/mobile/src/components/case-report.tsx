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

import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Framed } from '@/components/framed';
import { ThemedText } from '@/components/themed-text';
import {
  ErrorNotice,
  Loading,
  MatchBadge,
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
  const zone = report.impact.zone;
  // "Front-right collision" rather than "front, right · severity 3/3" — the
  // severity number meant nothing without the ladder beside it.
  const where = side && side !== 'centre' ? `${zone}-${side}` : zone;
  return `${where.charAt(0).toUpperCase()}${where.slice(1)} collision`;
}

/** How much a probability must move before it is worth pointing at. */
const CASCADE_EPSILON = 0.005;

/** How long a moved row stays highlighted after a confirmation. */
const CASCADE_HIGHLIGHT_MS = 6000;

interface Change {
  from: number;
  to: number;
}

/**
 * What the last tap did to everything else.
 *
 * The cascade is the whole proof — tell the model one part is fine and the
 * parts behind it drop — but the arithmetic is undramatic: a dependent falls
 * by five to eighteen points, and only one or two cross the order threshold.
 * That is easy to miss on a stage, so the report is diffed against the one
 * before it and the rows that actually moved say so.
 */
function useCascade(report: CaseReport | null) {
  const previous = useRef<Map<string, number> | null>(null);
  const previousOrder = useRef<Set<string>>(new Set());
  const [changes, setChanges] = useState<Map<string, Change>>(new Map());
  const [departed, setDeparted] = useState(0);

  useEffect(() => {
    if (!report) return;

    const now = new Map<string, number>();
    for (const section of Object.values(report.sections)) {
      for (const line of section) now.set(line.part_id, line.p);
    }
    const before = previous.current;
    const beforeOrder = previousOrder.current;
    const nowOrder = new Set(report.sections.order.map((l) => l.part_id));
    previous.current = now;
    previousOrder.current = nowOrder;

    // The first report has nothing to be a change from.
    if (!before) return;

    const moved = new Map<string, Change>();
    for (const [partId, to] of now) {
      const from = before.get(partId);
      if (from != null && Math.abs(to - from) >= CASCADE_EPSILON) {
        moved.set(partId, { from, to });
      }
    }
    // Parts that fell out of the order bucket moved the most of all, and are
    // no longer on screen to say so themselves.
    const gone = [...beforeOrder].filter((partId) => !nowOrder.has(partId)).length;

    setChanges(moved);
    setDeparted(gone);
    if (moved.size === 0 && gone === 0) return;

    const timer = setTimeout(() => {
      setChanges(new Map());
      setDeparted(0);
    }, CASCADE_HIGHLIGHT_MS);
    return () => clearTimeout(timer);
  }, [report]);

  return { changes, departed };
}

type SectionKey = 'confirmed' | 'unconfirmed' | 'predicted';

/** The marker beside a group name: settled, waiting on you, or the model's guess. */
function StatusDot({ kind }: { kind: 'solid' | 'hollow' | 'muted' }) {
  const theme = useTheme();
  return (
    <View
      style={[
        styles.dot,
        kind === 'solid' && { backgroundColor: theme.accent },
        kind === 'hollow' && { borderWidth: 1.5, borderColor: theme.accent },
        kind === 'muted' && { backgroundColor: theme.textSecondary },
      ]}
    />
  );
}

/**
 * ✓ / ✗ sized down.
 *
 * The full-width pair is right when a card holds one decision, but these sit inside a
 * grouped list where every row has them — at full size the buttons become the list.
 */
function CompactConfirm({
  line,
  busy,
  onConfirm,
}: {
  line: ReportLine;
  busy: boolean;
  onConfirm: (partId: string, damaged: boolean) => void;
}) {
  const theme = useTheme();

  if (line.confirmed != null) {
    return (
      <View style={styles.miniReviewed}>
        <Ionicons
          name={line.confirmed ? 'checkmark-circle' : 'close-circle-outline'}
          size={15}
          color={line.confirmed ? theme.success : theme.textSecondary}
        />
        <ThemedText
          type="small"
          style={{ color: line.confirmed ? theme.success : theme.textSecondary }}
        >
          {line.confirmed ? 'Confirmed damaged' : 'Ruled out'}
        </ThemedText>
      </View>
    );
  }

  return (
    <View style={styles.miniRow}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Confirm ${line.name} is damaged`}
        disabled={busy}
        onPress={() => onConfirm(line.part_id, true)}
        style={({ pressed }) => [
          styles.miniButton,
          { borderColor: theme.success, opacity: pressed ? 0.6 : 1 },
        ]}
      >
        <Ionicons name="checkmark" size={14} color={theme.success} />
        <ThemedText type="small" style={{ color: theme.success }}>
          Damaged
        </ThemedText>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Rule out ${line.name}`}
        disabled={busy}
        onPress={() => onConfirm(line.part_id, false)}
        style={({ pressed }) => [
          styles.miniButton,
          { borderColor: theme.border, opacity: pressed ? 0.6 : 1 },
        ]}
      >
        <Ionicons name="close" size={14} color={theme.textSecondary} />
        <ThemedText type="small" themeColor="textSecondary">
          Not damaged
        </ThemedText>
      </Pressable>
    </View>
  );
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
  const cascade = useCascade(report);

  /**
   * Which group is expanded. Hidden damage on arrival: it is what the product is for, and
   * the only group with a decision attached to every row.
   */
  const [openSection, setOpenSection] = useState<SectionKey | null>('confirmed');
  const toggleSection = (key: SectionKey) =>
    setOpenSection((current) => (current === key ? null : key));

  const resolving = vehicle?.status === 'resolving';

  /**
   * The masthead, laid out like the customer's approval page: name, one quiet line of
   * context, then a card that says what the job amounts to before any row of it.
   *
   * This replaced a full-width tinted status pill. The pill gave the loading state the
   * loudest element on a screen it only occupies for two seconds, then kept shouting.
   */
  const vehicleName = vehicle
    ? [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(' ') || vehicle.rego
    : null;

  const subtitle = [
    vehicle?.rego,
    vehicle?.parts_indexed ? `${vehicle.parts_indexed.toLocaleString()} parts` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const statusPill = (
    <View style={styles.masthead}>
      {vehicleName ? <ThemedText type="section">{vehicleName}</ThemedText> : null}
      <View style={styles.mastheadSub}>
        {resolving ? (
          <Ionicons name="ellipsis-horizontal" size={13} color={theme.textSecondary} />
        ) : null}
        <ThemedText type="small" themeColor="textSecondary">
          {vehicleName ? subtitle || vehicleStatusLine(vehicle) : vehicleStatusLine(vehicle)}
        </ThemedText>
      </View>
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

  /**
   * Regrouped by who decided, not by which bucket the engine used.
   *
   *   Confirmed    established damage — the camera saw it, or you ticked it
   *   Unconfirmed  waiting on your call
   *   AI-predicted the model inferred it and nobody has touched it
   *
   * A part moves up a group as you tick it, which is the point of the grouping: the screen
   * shows how much of the job is settled rather than which engine bucket a row came out of.
   *
   * Note that a part ticked *not* damaged does not land in Unconfirmed — the backend drops
   * it from the report entirely — so "unconfirmed" means undecided, not ruled out.
   */
  const ticked = (line: ReportLine) => line.confirmed === true;
  const undecided = (line: ReportLine) => line.confirmed == null;

  const groups: {
    key: SectionKey;
    title: string;
    dot: 'solid' | 'hollow' | 'muted';
    empty: string;
    lines: ReportLine[];
  }[] = [
    {
      key: 'confirmed',
      title: 'Confirmed',
      dot: 'solid',
      empty: 'Nothing confirmed yet.',
      lines: [
        ...report.sections.visible,
        ...report.sections.order.filter(ticked),
        ...report.sections.check.filter(ticked),
      ],
    },
    {
      key: 'unconfirmed',
      title: 'Unconfirmed',
      dot: 'hollow',
      empty: 'Nothing waiting on you.',
      lines: report.sections.check.filter(undecided),
    },
    {
      key: 'predicted',
      title: 'AI-predicted',
      dot: 'muted',
      empty: 'Nothing predicted yet.',
      lines: report.sections.order.filter(undecided),
    },
  ];

  const flagged = groups.reduce((total, group) => total + group.lines.length, 0);

  return (
    <ScrollView contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled">
      {statusPill}

      {said ? (
        <View style={styles.saidBlock}>
          <SectionLabel>YOU SAID</SectionLabel>
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

      {/* The job in one line, with a chip per group. Crop-marked because it is the one
          block on the screen that summarises rather than lists. */}
      <Framed style={styles.flagged}>
        <ThemedText type="section">
          {flagged} part{flagged === 1 ? '' : 's'} flagged
        </ThemedText>
        {impact ? (
          <ThemedText type="small" themeColor="textSecondary">
            {impact}
          </ThemedText>
        ) : null}
        <View style={styles.flaggedChips}>
          {groups.map((group) => (
            <View
              key={group.key}
              style={[
                styles.flaggedChip,
                {
                  borderColor: group.key === 'unconfirmed' ? theme.accent : 'transparent',
                  backgroundColor:
                    group.key === 'unconfirmed' ? 'transparent' : theme.backgroundElement,
                },
              ]}
            >
              <ThemedText
                type="small"
                style={{
                  color: group.key === 'unconfirmed' ? theme.accent : theme.textSecondary,
                }}
              >
                {group.lines.length} {group.title.toLowerCase()}
              </ThemedText>
            </View>
          ))}
        </View>
      </Framed>

      {/* --- The one clarifying question ------------------------------------- */}
      {report.question ? (
        <View
          style={[
            styles.questionCard,
            { borderColor: theme.accent, backgroundColor: theme.backgroundElement },
          ]}
        >
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

      {/* So the tap registers as having moved the model, not just the one row. */}
      {cascade.changes.size > 0 || cascade.departed > 0 ? (
        <View style={[styles.cascadeNote, { borderColor: theme.accent }]}>
          <Ionicons name="git-branch-outline" size={15} color={theme.accent} />
          <ThemedText type="smallBold" style={{ color: theme.accent }}>
            {cascade.changes.size + cascade.departed} part
            {cascade.changes.size + cascade.departed === 1 ? '' : 's'} re-ranked
            {cascade.departed > 0 ? ` · ${cascade.departed} dropped out` : ''}
          </ThemedText>
        </View>
      ) : null}

      {/* --- The three groups. Rows live inside the card, not under it. ------- */}
      {groups.map((group) => {
        const open = openSection === group.key;
        return (
          <View
            key={group.key}
            style={[
              styles.groupCard,
              { borderColor: theme.border, backgroundColor: theme.backgroundElement },
            ]}
          >
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ expanded: open }}
              accessibilityLabel={`${group.title}, ${group.lines.length} parts`}
              onPress={() => toggleSection(group.key)}
              style={({ pressed }) => [styles.groupHead, { opacity: pressed ? 0.6 : 1 }]}
            >
              <StatusDot kind={group.dot} />
              <ThemedText type="rowTitle" style={styles.grow}>
                {group.title}
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {group.lines.length}
              </ThemedText>
              <Ionicons
                name={open ? 'chevron-up' : 'chevron-down'}
                size={17}
                color={theme.textSecondary}
              />
            </Pressable>

            {open
              ? group.lines.map((line) => (
                  <View
                    key={line.part_id}
                    style={[styles.groupRow, { borderTopColor: theme.border }]}
                  >
                    <View style={styles.groupRowHead}>
                      <ThemedText style={styles.grow} numberOfLines={2}>
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

                    <CompactConfirm
                      line={line}
                      busy={busyId === line.part_id}
                      onConfirm={onConfirm}
                    />
                  </View>
                ))
              : null}

            {open && group.lines.length === 0 ? (
              <View style={[styles.groupRow, { borderTopColor: theme.border }]}>
                <ThemedText type="small" themeColor="textSecondary">
                  {group.key === 'confirmed'
                    ? 'Nothing confirmed yet.'
                    : group.key === 'unconfirmed'
                      ? 'Nothing waiting on you.'
                      : 'Nothing predicted yet.'}
                </ThemedText>
              </View>
            ) : null}
          </View>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  pending: { padding: Spacing.three, gap: Spacing.three },
  // Tighter than the old crop-marked layout: cards carry their own edges, so they need
  // less air between them. Section headings buy the separation back with padding.
  list: { padding: Spacing.three, gap: Spacing.three, paddingBottom: Spacing.five },

  // Masthead, as on the customer's page: name, then one quiet line under it.
  masthead: { gap: 2 },
  mastheadSub: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },

  // The job in one block, before any row of it.
  summaryCard: {
    gap: Spacing.two,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.card,
    padding: Spacing.three,
  },
  summaryBody: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two },
  summaryBadge: {
    borderRadius: Radius.round,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.half,
  },
  summaryText: { flex: 1 },

  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderRadius: Radius.round,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  statusText: { flex: 1, fontWeight: '600' },
  impact: { marginTop: -Spacing.two },

  // A one-line "what this block is and what to do", under each heading.
  sectionIntro: { marginTop: -Spacing.two },

  // Observed damage reads as cards, matching the plan cards on the customer's page:
  // a bordered, rounded block with the name doing the work and one control on the right.
  seenGroup: { gap: Spacing.two },
  seenCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.card - 4,
    paddingVertical: Spacing.three,
    paddingLeft: Spacing.three,
    paddingRight: Spacing.two,
  },
  seenBody: { flex: 1, gap: 2 },
  seenPartNumber: { fontSize: 12 },
  seenRemove: {
    width: 34,
    height: 34,
    borderRadius: Radius.round,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Predicted damage: a heavier card with an accent edge. The weight is the
  // point — this is the half of the screen the product is for.
  // Cards abut so adjacent crop marks sit on one shared rule, the way the
  // mockup stacks them.
  heroGroup: { gap: 0 },
  // A rounded, bordered card, sized like the plan cards on the customer's page.
  heroCard: {
    padding: Spacing.three,
    gap: Spacing.two,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.card,
  },
  heroHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
  },
  // Bigger and tighter than a plain row title: in the mockup the part name is
  // clearly the focal point of its card, above the reason that explains it.
  heroName: {
    flex: 1,
    fontSize: 19,
    lineHeight: 25,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  heroReason: { fontSize: 16, lineHeight: 24 },
  hardwareList: { paddingLeft: Spacing.four, gap: Spacing.half },
  deltaRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  cascadeNote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    alignSelf: 'flex-start',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.round,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },

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

  grow: { flex: 1 },

  dot: { width: 9, height: 9, borderRadius: Radius.round },

  // The one summarising block on the screen, so it keeps the crop marks.
  flagged: { gap: Spacing.two },
  flaggedChips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  flaggedChip: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.chip,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one,
  },

  // A group is one card: the header and its rows share a border, rather than the
  // rows floating underneath as separate cards.
  groupCard: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.card,
    overflow: 'hidden',
  },
  groupHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    minHeight: TapTarget,
    paddingHorizontal: Spacing.three,
  },
  groupRow: {
    gap: Spacing.one,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  groupRowHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },

  miniRow: { flexDirection: 'row', gap: Spacing.two, marginTop: Spacing.one },
  miniButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.one,
    minHeight: 32,
    paddingHorizontal: Spacing.two,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.chip,
  },
  miniReviewed: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    marginTop: Spacing.one,
  },
  // A tappable section header, sized like a card so the three of them read as the
  // top level of the report when they are all closed.
  sectionBar: {
    gap: Spacing.two,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.card,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
  },
  sectionBarHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },

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
