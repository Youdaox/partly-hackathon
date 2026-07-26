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
import Animated, { FadeInDown } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';

import { Framed } from '@/components/framed';
import { ThemedText } from '@/components/themed-text';
import {
  ErrorNotice,
  Loading,
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
  /**
   * Parts that were not in the previous report at all.
   *
   * Answering the side question is the case that made this necessary: it flips the impact
   * from right to left, and the list swaps six parts for six others. Almost nothing
   * *moves* — the change is entirely arrivals and departures, so diffing probabilities
   * alone reported "nothing changed" on the one interaction that changes the most.
   */
  const [arrived, setArrived] = useState<Set<string>>(new Set());

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
    const fresh = new Set([...now.keys()].filter((partId) => !before.has(partId)));

    setChanges(moved);
    setDeparted(gone);
    setArrived(fresh);
    if (moved.size === 0 && gone === 0 && fresh.size === 0) return;

    const timer = setTimeout(() => {
      setChanges(new Map());
      setDeparted(0);
      setArrived(new Set());
    }, CASCADE_HIGHLIGHT_MS);
    return () => clearTimeout(timer);
  }, [report]);

  return { changes, departed, arrived };
}

/**
 * Where a probability came from, in one line.
 *
 * The number is a noisy-OR over decomposable terms, and `attribution` is that
 * decomposition — each cause's share of the log-odds, summing to 1. Printing
 * the top two is the difference between a repairer reading "88%" as a figure
 * the app invented and reading it as a figure with parts he can check.
 *
 * `root` is the impact reaching this part's depth in its zone; `leak` is the
 * rate the class gets replaced regardless; anything else names the part that
 * drove it. Worth knowing when reading these: on most predictions the impact
 * term is the larger one, so the line will often say so — which is honest
 * about how much of the number is the graph and how much is the class.
 */
function justify(line: ReportLine): string {
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
    .join('  ·  ');
}


type SectionKey = 'confirmed' | 'predicted';

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
  const [openSection, setOpenSection] = useState<SectionKey>('confirmed');

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
   * Two filters, split by who decided.
   *
   *   Confirmed     established — the camera saw it, or you ticked it
   *   AI-predicted  the model's, and you have not ruled on it yet
   *
   * There is no third "unconfirmed" group: a part ticked ✗ is dropped from the report by
   * the backend entirely, so undecided parts from the check bucket sit under AI-predicted
   * with everything else awaiting a decision. Two buttons, and every part in one of them.
   */
  const ticked = (line: ReportLine) => line.confirmed === true;
  const undecided = (line: ReportLine) => line.confirmed == null;

  const groups: { key: SectionKey; title: string; empty: string; lines: ReportLine[] }[] = [
    {
      key: 'confirmed',
      title: 'Confirmed',
      empty: 'Nothing confirmed yet.',
      lines: [
        ...report.sections.visible,
        ...report.sections.order.filter(ticked),
        ...report.sections.check.filter(ticked),
      ],
    },
    {
      key: 'predicted',
      title: 'AI-predicted',
      empty: 'Nothing predicted yet.',
      lines: [
        ...report.sections.order.filter(undecided),
        ...report.sections.check.filter(undecided),
      ],
    },
  ];

  const flagged = groups.reduce((total, group) => total + group.lines.length, 0);
  const active = groups.find((group) => group.key === openSection) ?? groups[0];
  const confirmedView = active.key === 'confirmed';

  return (
    <ScrollView contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled">
      {statusPill}

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
        <ThemedText type="section" style={styles.centred}>
          {flagged} part{flagged === 1 ? '' : 's'} flagged
        </ThemedText>
        {impact ? (
          <ThemedText type="small" themeColor="textSecondary" style={styles.centred}>
            {impact}
          </ThemedText>
        ) : null}
      </Framed>

      {/* Two filters, not three collapsing sections. The count leads because it is what
          the repairer is scanning for; the selected one fills so the choice is obvious
          from arm's length. */}
      <View style={styles.filters}>
        {groups.map((group) => {
          const selected = group.key === active.key;
          return (
            <Pressable
              key={group.key}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              accessibilityLabel={`${group.title}, ${group.lines.length} parts`}
              onPress={() => setOpenSection(group.key)}
              style={({ pressed }) => [
                styles.filter,
                {
                  borderColor: selected ? theme.accent : 'transparent',
                  backgroundColor: selected ? theme.accent : theme.badgeFill,
                  // A press dips the button rather than fading it. Opacity on a filled
                  // navy surface reads as the button breaking; scale reads as a press.
                  transform: [{ scale: pressed ? 0.97 : 1 }],
                },
              ]}
            >
              <ThemedText
                type="smallBold"
                style={{ color: selected ? theme.accentText : theme.accent }}
              >
                {group.title}
              </ThemedText>
              {/* The count rides in a chip beside the label rather than dwarfing
                  it — it is how many, not the point of the button. */}
              <View
                style={[
                  styles.filterCount,
                  {
                    backgroundColor: selected ? 'rgba(255,255,255,0.22)' : theme.backgroundElement,
                  },
                ]}
              >
                <ThemedText
                  type="small"
                  style={{ color: selected ? theme.accentText : theme.accent }}
                >
                  {group.lines.length}
                </ThemedText>
              </View>
            </Pressable>
          );
        })}
      </View>

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
      {cascade.changes.size > 0 || cascade.departed > 0 || cascade.arrived.size > 0 ? (
        <View style={[styles.cascadeNote, { borderColor: theme.accent }]}>
          <Ionicons name="git-branch-outline" size={15} color={theme.accent} />
          <ThemedText type="smallBold" style={{ color: theme.accent }}>
            {[
              cascade.arrived.size > 0 ? `${cascade.arrived.size} new` : null,
              cascade.changes.size > 0 ? `${cascade.changes.size} re-ranked` : null,
              cascade.departed > 0 ? `${cascade.departed} dropped out` : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </ThemedText>
        </View>
      ) : null}

      {/* --- The selected filter's parts, one card each. --------------------- */}
      <View style={styles.cardList}>
        {active.lines.length === 0 ? (
          <View
            style={[
              styles.partCard,
              { borderColor: theme.border, backgroundColor: theme.backgroundElement },
            ]}
          >
            <ThemedText type="small" themeColor="textSecondary">
              {active.empty}
            </ThemedText>
          </View>
        ) : (
          active.lines.map((line, index) => {
            // What the last answer or tick did to this row. Tinting it is the whole
            // proof that one answer moves the model, not just the row you touched.
            const change = cascade.changes.get(line.part_id);
            const isNew = cascade.arrived.has(line.part_id);
            const dropped = change != null && change.to < change.from;

            return (
              // Cards fade in on a filter swap and when the model adds one, so a list
              // that rearranged under your thumb is visibly a change, not a redraw.
              // Staggered slightly, capped so a twelve-part list does not crawl.
              <Animated.View
                key={line.part_id}
                entering={FadeInDown.duration(180).delay(Math.min(index, 6) * 25)}
                style={[
                  styles.partCard,
                  {
                    borderColor: theme.border,
                    backgroundColor:
                      change != null || isNew ? theme.badgeFill : theme.backgroundElement,
                  },
                ]}
              >
                <View style={styles.partCardBody}>
                  {/* The likelihood leads the card, at a size you can read at
                      arm's length — it is the number the repairer sorts on.
                      Only predictions carry it; a confirmed part is a fact. */}
                  {confirmedView ? null : (
                    <View style={styles.percentBlock}>
                      <ThemedText style={styles.percentValue}>
                        {Math.round(line.p * 100)}
                      </ThemedText>
                      <ThemedText style={[styles.percentSign, { color: theme.textSecondary }]}>
                        %
                      </ThemedText>
                    </View>
                  )}

                  <View style={styles.grow}>
                    <View style={styles.partCardHead}>
                      {isNew ? (
                        <View style={[styles.newBadge, { backgroundColor: theme.accent }]}>
                          <ThemedText type="small" style={{ color: theme.accentText }}>
                            new
                          </ThemedText>
                        </View>
                      ) : null}
                      <ThemedText type="rowTitle" style={styles.grow} numberOfLines={1}>
                        {line.name}
                        {line.qty > 1 ? (
                          <ThemedText type="smallBold" style={{ color: theme.textSecondary }}>
                            {'  ×'}{line.qty}
                          </ThemedText>
                        ) : null}
                      </ThemedText>
                    </View>

                    {/* The move itself, in points, legible from a metre away.
                        It stands in for the justification while it shows, so a
                        moved card is the same height as a still one. */}
                    {change != null ? (
                      <View style={styles.deltaRow}>
                        <Ionicons
                          name={dropped ? 'arrow-down' : 'arrow-up'}
                          size={13}
                          color={dropped ? theme.textSecondary : theme.danger}
                        />
                        <ThemedText
                          type="smallBold"
                          style={{ color: dropped ? theme.textSecondary : theme.danger }}
                        >
                          {dropped ? '' : '+'}
                          {Math.round((change.to - change.from) * 100)} points
                        </ThemedText>
                        <ThemedText type="small" themeColor="textSecondary">
                          was {Math.round(change.from * 100)}%
                        </ThemedText>
                      </View>
                    ) : (
                      // Why this number, not a number. Two lines, clamped, so
                      // every card is the same height whatever it says.
                      <ThemedText
                        type="small"
                        themeColor="textSecondary"
                        numberOfLines={2}
                        style={styles.justification}
                      >
                        {confirmedView ? 'Confirmed at the car' : justify(line)}
                      </ThemedText>
                    )}

                    {confirmedView ? (
                      <View style={styles.verifiedRow}>
                        <Ionicons name="checkmark" size={14} color={theme.textSecondary} />
                        <ThemedText type="small" themeColor="textSecondary">
                          verified
                        </ThemedText>
                      </View>
                    ) : (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Confirm ${line.name} is damaged`}
                        disabled={busyId === line.part_id}
                        onPress={() => onConfirm(line.part_id, true)}
                        hitSlop={8}
                        style={({ pressed }) => [
                          styles.confirmLink,
                          { opacity: pressed ? 0.5 : 1 },
                        ]}
                      >
                        <ThemedText type="smallBold" style={{ color: theme.accent }}>
                          Confirm
                        </ThemedText>
                        <Ionicons name="arrow-forward" size={14} color={theme.accent} />
                      </Pressable>
                    )}
                  </View>
                </View>
              </Animated.View>
            );
          })
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  pending: { padding: Spacing.three, gap: Spacing.three },
  // Tighter than the old crop-marked layout: cards carry their own edges, so they need
  // less air between them. Section headings buy the separation back with padding.
  // Capped and centred. Without the cap the cards stretch the full width of a desktop
  // browser, which is where this gets demoed — a 2000px-wide part row is unreadable.
  list: {
    padding: Spacing.three,
    gap: Spacing.three,
    paddingBottom: Spacing.five,
    width: '100%',
    maxWidth: 560,
    alignSelf: 'center',
  },

  // Masthead, as on the customer's page: name, then one quiet line under it.
  masthead: { gap: 2, alignItems: 'center' },
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
  newBadge: {
    borderRadius: Radius.chip,
    paddingHorizontal: Spacing.one + 2,
    paddingVertical: 1,
  },
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

  questionCard: {
    gap: Spacing.three,
    borderLeftWidth: 2,
    paddingLeft: Spacing.three,
    paddingVertical: Spacing.three,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two, marginTop: Spacing.two },
  // Taller than the 44 minimum: the answer chips sit inside the question card and
  // were reading as cramped against its border.
  chip: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.chip,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
  },

  grow: { flex: 1 },

  // Two filter buttons, equal width. The count is the headline; the label sits under it.
  filters: { flexDirection: 'row', gap: Spacing.two },
  filter: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.card,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
  },
  filterCount: {
    minWidth: 22,
    paddingHorizontal: Spacing.one,
    paddingVertical: 1,
    borderRadius: Radius.chip,
    alignItems: 'center',
  },

  // The one summarising block on the screen, so it keeps the crop marks.
  flagged: { gap: Spacing.two, alignItems: 'center' },
  centred: { textAlign: 'center' },
  flaggedChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: Spacing.two,
  },
  flaggedChip: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.chip,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one,
  },

  // A group is one card: the header and its rows share a border, rather than the
  // rows floating underneath as separate cards.
  // One card per part, as the mockup has them — the grouped list read as a
  // table, and a table invites scanning rather than deciding.
  cardList: { gap: Spacing.two },
  // One fixed height for every card. Heights used to vary with how far a part
  // name wrapped and whether the last answer had moved that row, which turned
  // a scannable column into a ragged one. The name is clamped to a line and the
  // justification to two, so the box is the same box every time.
  partCard: {
    height: 132,
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.card,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  partCardBody: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.three },
  partCardHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },

  // The likelihood, set large enough to sort on from arm's length.
  percentBlock: { flexDirection: 'row', alignItems: 'flex-start', minWidth: 52 },
  percentValue: { fontSize: 34, lineHeight: 38, fontWeight: '300', letterSpacing: -1 },
  percentSign: { fontSize: 13, lineHeight: 20, marginTop: 4, marginLeft: 1 },

  justification: { marginTop: 2, lineHeight: 18 },
  verifiedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    marginTop: Spacing.one,
  },
  confirmLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    marginTop: Spacing.two,
    minHeight: 28,
  },
  rowRemove: {
    width: 32,
    height: 32,
    borderRadius: Radius.round,
    alignItems: 'center',
    justifyContent: 'center',
  },

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
