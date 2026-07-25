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

import { Fragment, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

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

/** ✓ / ✗ — the only interaction: two taps, greasy hands. */
function ConfirmRow({
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
    );
  }

  return (
    <View style={styles.answerRow}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Confirm ${line.name} is damaged`}
        disabled={busy}
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
        disabled={busy}
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
  );
}

/**
 * One predicted part — the row the whole screen exists for.
 *
 * Leads with the name and the plain-language reason, because that is the pair
 * a repairer reads. The part number is the thing they phone through later, so
 * it is demoted to a small monospace second line rather than competing with
 * the name. The fasteners that come with the part are folded away: they are
 * real and they get ordered, but nine clip rows are what made this list
 * unreadable.
 */
function HiddenRow({
  line,
  index,
  busy,
  change,
  onConfirm,
}: {
  line: ReportLine;
  index: number;
  busy: boolean;
  /** Set when the last confirmation moved this part's probability. */
  change?: Change;
  onConfirm: (partId: string, damaged: boolean) => void;
}) {
  const theme = useTheme();
  const [showHardware, setShowHardware] = useState(false);
  const hardware = line.hardware ?? [];
  const dropped = change != null && change.to < change.from;

  return (
    // A rounded card, matching the plan cards on the customer's approval page. The
    // crop-mark frame that used to be here drew its ticks hard against the screen
    // edges, where they read as stray `+` glyphs rather than registration marks.
    <View
      style={[
        styles.heroCard,
        { borderColor: theme.border, backgroundColor: theme.backgroundElement },
        // A moved row says so for a few seconds, so the tap that moved it is
        // visibly what moved it.
        change != null && { backgroundColor: theme.badgeFill, borderColor: theme.accent },
      ]}
    >
      {/* Numbered circle · bold name · % match, all on one line. The badge is
          numerical on purpose: 95% and 38% are different decisions, and three
          bands flattened them into the same word. */}
      <View style={styles.heroHead}>
        <NumberBadge n={index + 1} />
        <ThemedText style={styles.heroName}>
          {line.name}
          {line.qty > 1 ? ` ×${line.qty}` : ''}
        </ThemedText>
        {/* A settled part shows its state, not a percentage. */}
        {line.confirmed == null ? <MatchBadge value={line.p} /> : null}
      </View>

      {change != null ? (
        <View style={styles.deltaRow}>
          <Ionicons
            name={dropped ? 'arrow-down' : 'arrow-up'}
            size={13}
            color={dropped ? theme.textSecondary : theme.danger}
          />
          <ThemedText
            type="small"
            style={{ color: dropped ? theme.textSecondary : theme.danger }}
          >
            {Math.round(change.from * 100)}% → {Math.round(change.to * 100)}%
          </ThemedText>
        </View>
      ) : null}

      {line.reason ? (
        // Body size, not caption size: the reason is the sentence a repairer
        // actually reads, so it gets the same weight as the mockup gives it.
        <ThemedText themeColor="textSecondary" style={styles.heroReason}>
          {line.reason}
        </ThemedText>
      ) : null}

      {line.part_number ? (
        <ThemedText type="small" themeColor="textSecondary" style={styles.partNumber}>
          {line.part_number}
        </ThemedText>
      ) : null}

      {hardware.length > 0 ? (
        <Fragment>
          <Pressable
            accessibilityRole="button"
            onPress={() => setShowHardware((open) => !open)}
            style={({ pressed }) => [styles.whyToggle, { opacity: pressed ? 0.6 : 1 }]}
          >
            <Ionicons
              name={showHardware ? 'chevron-up' : 'chevron-down'}
              size={15}
              color={theme.textSecondary}
            />
            <ThemedText type="small" themeColor="textSecondary">
              {showHardware ? 'Hide' : `+ ${hardware.length}`} fastener
              {hardware.length === 1 ? '' : 's'} &amp; seals
            </ThemedText>
          </Pressable>
          {showHardware ? (
            <View style={styles.hardwareList}>
              {hardware.map((item) => (
                <ThemedText key={item.part_id} type="small" themeColor="textSecondary">
                  {item.name}
                  {item.qty > 1 ? ` ×${item.qty}` : ''}
                </ThemedText>
              ))}
            </View>
          ) : null}
        </Fragment>
      ) : null}

      {/* The cascade lives here. Crossing out a predicted *parent* is the demo
          line — "watch what happens to the parts behind it" — and only these
          have parts behind them. The check section's terminal items do not,
          which is why the control looked broken when it was only down there. */}
      <ConfirmRow line={line} busy={busy} onConfirm={onConfirm} />
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
   * Observed damage. Compact, muted, no number — Partly saw it, so it is a
   * fact and the row's job is just to name it.
   */
  /**
   * One observed part.
   *
   * Carries a remove control because the camera is not always right — a scuff the
   * interpreter read as a damaged panel has to be dismissable, or the quote goes out with a
   * part the customer does not need. Removing is `confirm(part, damaged: false)`: the engine
   * clamps it to zero and drops it from the report entirely, which is exactly the semantics
   * of "I looked, it is fine".
   */
  const visibleLine = (line: ReportLine) => (
    <View
      key={line.part_id}
      style={[styles.seenCard, { borderColor: theme.border, backgroundColor: theme.backgroundElement }]}
    >
      <View style={styles.seenBody}>
        <ThemedText type="rowTitle" numberOfLines={2}>
          {line.name}
          {line.qty > 1 ? (
            <ThemedText type="smallBold" style={{ color: theme.textSecondary }}>
              {'  '}×{line.qty}
            </ThemedText>
          ) : null}
        </ThemedText>
        {line.part_number ? (
          <ThemedText type="small" themeColor="textSecondary" style={styles.seenPartNumber}>
            {line.part_number}
          </ThemedText>
        ) : null}
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Remove ${line.name} — not actually damaged`}
        disabled={busyId === line.part_id}
        onPress={() => onConfirm(line.part_id, false)}
        hitSlop={8}
        style={({ pressed }) => [styles.seenRemove, { opacity: pressed ? 0.5 : 1 }]}
      >
        <Ionicons name="close" size={18} color={theme.textSecondary} />
      </Pressable>
    </View>
  );

  return (
    <ScrollView contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled">
      {/* Track A progress. Never blocks anything below it. */}
      {statusPill}

      {/* Read first: the shape of the job before any row. */}
      {/* What the job amounts to, before any row of it — the same summary block the
          customer sees on their approval page, so the two read as one product. */}
      {impact ? (
        <View
          style={[
            styles.summaryCard,
            { borderColor: theme.border, backgroundColor: theme.backgroundElement },
          ]}
        >
          <ThemedText type="rowTitle">
            {report.sections.visible.length + report.sections.order.length} parts need replacing
          </ThemedText>
          <View style={styles.summaryBody}>
            {report.sections.order.length > 0 ? (
              <View style={[styles.summaryBadge, { backgroundColor: theme.badgeFill }]}>
                <ThemedText type="smallBold" style={{ color: theme.badgeText }}>
                  {report.sections.order.length} found early
                </ThemedText>
              </View>
            ) : null}
            <ThemedText type="small" themeColor="textSecondary" style={styles.summaryText}>
              {impact}. {report.sections.order.length > 0
                ? 'Parts predicted behind the panels are already in the list, so the order goes out once.'
                : 'Nothing is predicted behind the panels yet.'}
            </ThemedText>
          </View>
        </View>
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
        <View style={[styles.questionCard, { borderColor: theme.accent, backgroundColor: theme.backgroundElement }]}>
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
            Asked because answering moves the report more than anything else.
          </ThemedText>
        </View>
      ) : null}

      {/* --- Visible damage: facts, deliberately quiet --------------------- */}
      <View style={styles.sectionHead}>
        <ThemedText type="section">Visible damage</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {report.sections.visible.length}
        </ThemedText>
      </View>
      <ThemedText type="small" themeColor="textSecondary" style={styles.sectionIntro}>
        What the camera saw. Remove anything that is not actually damaged.
      </ThemedText>
      {report.sections.visible.length === 0 ? (
        <EmptyState message="Nothing recorded as visible yet." />
      ) : (
        <View style={styles.seenGroup}>{report.sections.visible.map(visibleLine)}</View>
      )}

      {/* --- Hidden damage: the hero -------------------------------------- */}
      <View style={styles.sectionHead}>
        <ThemedText type="section">Hidden damage — what we predict</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {report.sections.order.length}
        </ThemedText>
      </View>
      <ThemedText type="small" themeColor="textSecondary" style={styles.sectionIntro}>
        In no photo. Order these with the panels — tick or cross one and the parts behind
        it move.
      </ThemedText>

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
      {report.sections.order.length === 0 ? (
        <EmptyState message="Nothing else implied yet." />
      ) : (
        <View style={styles.heroGroup}>
          {report.sections.order.map((line, index) => (
            <HiddenRow
              key={line.part_id}
              line={line}
              index={index}
              busy={busyId === line.part_id}
              change={cascade.changes.get(line.part_id)}
              onConfirm={onConfirm}
            />
          ))}
        </View>
      )}

      {/* --- Check on teardown: an action, not a list ---------------------- */}
      <View style={styles.sectionHead}>
        <ThemedText type="section">Check on teardown</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {report.sections.check.length}
        </ThemedText>
      </View>
      <ThemedText type="small" themeColor="textSecondary" style={styles.sectionIntro}>
        Look at these when it&apos;s apart, in this order — each answer settles the most.
      </ThemedText>

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
                {line.qty > 1 ? ` ×${line.qty}` : ''}
              </ThemedText>
              {/* Predicted, so it carries the numerical match badge. A part
                  the repairer has already ticked or crossed is settled, and a
                  percentage on a settled part is noise. */}
              {line.confirmed == null ? <MatchBadge value={line.p} /> : null}
            </View>

            <View style={styles.metaRow}>
              {line.part_number ? (
                <ThemedText type="small" themeColor="textSecondary" style={styles.partNumber}>
                  {line.part_number}
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
            <ConfirmRow
              line={line}
              busy={busyId === line.part_id}
              onConfirm={onConfirm}
            />
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
