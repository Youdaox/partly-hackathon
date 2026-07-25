/**
 * The diagnosis, driven by the FastAPI prediction backend.
 *
 * Four things here exist only because of that backend, and none were possible against the
 * jobs API:
 *
 *  - the report arrives in the three sections a repairer thinks in (see / order / check),
 *    each line carrying a real orderable part number and a quantity;
 *  - one clarifying question, asked only when answering it moves the report enough to be
 *    worth the interruption — the `value` on it is that number;
 *  - an exact attribution per check line: which known-damaged parts contributed, through
 *    which relation, and by what share. Not a heuristic — the noisy-OR decomposes;
 *  - the impact zone comes from the vision pass rather than being guessed from part names.
 *
 * The vehicle resolves on a background track, so the pill at the top reports progress and
 * nothing on this screen waits for it.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { Framed } from '@/components/framed';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import {
  EmptyState,
  ErrorNotice,
  Loading,
  MatchBadge,
  NumberBadge,
  SectionLabel,
} from '@/components/ui';
import { ImpactZones } from '@/components/vehicle-zones';
import { NoFocusRing, Radius, Spacing, TapTarget } from '@/constants/theme';
import { toErrorInfo, useAsyncData } from '@/hooks/use-async-data';
import { useTheme } from '@/hooks/use-theme';
import {
  backend,
  pollVehicle,
  type CaseReport,
  type ReportLine,
  type VehiclePayload,
} from '@/lib/backend';
import { labelCase } from '@/lib/recent-cases';
import { impactZonePoint, sideLabel } from '@/lib/zones';

/** Track A progress, in the repairer's words rather than the schema's. */
function vehicleStatusLine(vehicle: VehiclePayload | null): string {
  if (!vehicle) return 'Looking up the vehicle…';
  switch (vehicle.status) {
    case 'resolving':
      return `Looking up ${vehicle.rego}…`;
    case 'catalogue_ready': {
      const name = [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(' ');
      const parts = vehicle.parts_indexed?.toLocaleString();
      return `${name} · ${parts} parts ready`;
    }
    case 'no_catalogue':
      return `${vehicle.rego} has no parts catalogue — claims stay class-level`;
    case 'not_found':
      return `${vehicle.rego} not found`;
    default:
      return vehicle.status;
  }
}

export default function CaseScreen() {
  const { id: caseId, vehicleId, said } = useLocalSearchParams<{
    id: string;
    vehicleId?: string;
    said?: string;
  }>();
  const theme = useTheme();

  const report = useAsyncData(() => backend.getResults(caseId), [caseId]);

  const [vehicle, setVehicle] = useState<VehiclePayload | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [answering, setAnswering] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [followUp, setFollowUp] = useState('');
  const [asking, setAsking] = useState(false);
  const [actionError, setActionError] = useState<{ title: string; detail?: string } | null>(null);

  /**
   * Track A. Polls until resolution settles, then reloads the report once — the prediction
   * only becomes part-level after the catalogue is in.
   */
  useEffect(() => {
    if (!vehicleId) return;
    let settled = false;
    const cancel = pollVehicle(vehicleId, (next) => {
      setVehicle(next);
      if (!settled && next.status !== 'resolving') {
        settled = true;
        // The drawer row was created before the make/model was known.
        const name = [next.year, next.make, next.model].filter(Boolean).join(' ');
        if (name) labelCase(caseId, `${name} · ${next.rego}`);
        void report.reload();
      }
    });
    return cancel;
    // Keyed on the vehicle alone; `report` is a new object every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vehicleId]);

  const apply = useCallback(
    (next: CaseReport) => {
      report.setData(next);
    },
    [report],
  );

  const confirm = useCallback(
    async (line: ReportLine, damaged: boolean) => {
      setBusyId(line.part_id);
      setActionError(null);
      try {
        // Confirming re-runs the whole prediction; the response is the new report.
        apply(await backend.confirmInspection(caseId, line.part_id, damaged));
      } catch (err) {
        setActionError(toErrorInfo(err));
      } finally {
        setBusyId(null);
      }
    },
    [caseId, apply],
  );

  const answer = useCallback(
    async (questionId: string, value: string) => {
      setAnswering(value);
      setActionError(null);
      try {
        apply(await backend.answerQuestion(caseId, questionId, value));
      } catch (err) {
        setActionError(toErrorInfo(err));
      } finally {
        setAnswering(null);
      }
    },
    [caseId, apply],
  );

  const askFollowUp = useCallback(async () => {
    const text = followUp.trim();
    if (!text || asking) return;
    setAsking(true);
    setActionError(null);
    try {
      await backend.sendMessage(caseId, text);
      apply(await backend.runPrediction(caseId));
      setFollowUp('');
    } catch (err) {
      setActionError(toErrorInfo(err));
    } finally {
      setAsking(false);
    }
  }, [followUp, asking, caseId, apply]);

  const rerun = useCallback(async () => {
    setActionError(null);
    try {
      apply(await backend.runPrediction(caseId));
    } catch (err) {
      setActionError(toErrorInfo(err));
    }
  }, [caseId, apply]);

  const data = report.data;
  const shownVehicle = vehicle ?? data?.vehicle ?? null;
  const title = shownVehicle
    ? [shownVehicle.year, shownVehicle.make, shownVehicle.model].filter(Boolean).join(' ') ||
      shownVehicle.rego
    : 'Diagnosis';

  const header = (
    <Stack.Screen
      options={{
        headerTitleAlign: 'center',
        headerTitle: () => (
          <View style={styles.headerTitle}>
            <ThemedText type="rowTitle">{title}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              Diagnosis
            </ThemedText>
          </View>
        ),
        headerRight: () => (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Re-run the prediction"
            onPress={rerun}
            hitSlop={12}
            style={styles.headerButton}
          >
            <Ionicons name="ellipsis-horizontal" size={22} color={theme.accent} />
          </Pressable>
        ),
      }}
    />
  );

  if (report.loading && !data) {
    return (
      <>
        {header}
        <ThemedView style={styles.container}>
          <Loading label="Running the prediction…" />
        </ThemedView>
      </>
    );
  }

  if (!data) {
    return (
      <>
        {header}
        <ThemedView style={styles.container}>
          <View style={styles.padded}>
            <ErrorNotice
              title={report.error?.title ?? 'Case not found'}
              detail={report.error?.detail}
            />
          </View>
        </ThemedView>
      </>
    );
  }

  const error = actionError ?? report.error;
  const resolving = shownVehicle?.status === 'resolving';
  const side = sideLabel(data.impact.side);

  /** A line in the see/order sections: no confirm, no attribution. */
  const renderPlainLine = (line: ReportLine, index: number) => (
    <Framed key={line.part_id} style={styles.row}>
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
    </Framed>
  );

  return (
    <>
      {header}
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={90}
      >
        <ThemedView style={styles.container}>
          <ScrollView contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled">
            {/* Track A progress. Never blocks anything below it. */}
            <View style={[styles.statusPill, { backgroundColor: theme.badgeFill }]}>
              <Ionicons
                name={resolving ? 'ellipsis-horizontal-circle-outline' : 'checkmark-circle'}
                size={16}
                color={theme.badgeText}
              />
              <ThemedText type="small" style={[styles.statusText, { color: theme.badgeText }]}>
                {vehicleStatusLine(shownVehicle)}
              </ThemedText>
              {shownVehicle?.resolved_ms ? (
                <ThemedText type="small" themeColor="textSecondary">
                  {shownVehicle.resolved_ms} ms
                </ThemedText>
              ) : null}
            </View>

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

            {data.degraded ? (
              <ErrorNotice
                title="No parts catalogue for this vehicle"
                detail="The assistant can still describe the damage, but cannot name orderable parts."
              />
            ) : null}

            {/* --- Affected zones, from the backend's own impact call --------------- */}
            <Framed style={styles.zonesCard}>
              <SectionLabel>AFFECTED ZONES</SectionLabel>
              <ImpactZones
                point={impactZonePoint(data.impact.zone)}
                count={data.sections.check.length || data.sections.visible.length}
              />
              {data.impact.zone ? (
                <ThemedText type="small" themeColor="textSecondary">
                  {data.impact.zone}
                  {side ? `, ${side}` : ''}
                  {data.impact.severity != null ? ` · severity ${data.impact.severity}/3` : ''}
                </ThemedText>
              ) : null}
            </Framed>

            {/* --- The one clarifying question ------------------------------------- */}
            {data.question ? (
              <Framed style={[styles.questionCard, { borderColor: theme.accent }]}>
                <SectionLabel>ONE QUESTION</SectionLabel>
                <ThemedText type="rowTitle">{data.question.text}</ThemedText>
                <View style={styles.chips}>
                  {data.question.options.map((option) => (
                    <Pressable
                      key={option}
                      accessibilityRole="button"
                      disabled={answering !== null}
                      onPress={() => answer(data.question!.id, option)}
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
                  {` (${data.question.value.toFixed(1)})`}.
                </ThemedText>
              </Framed>
            ) : null}

            {/* --- ✓ You can see these -------------------------------------------- */}
            <View style={styles.sectionHead}>
              <ThemedText type="section">You can see these</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {data.sections.visible.length} parts
              </ThemedText>
            </View>
            {data.sections.visible.length === 0 ? (
              <EmptyState message="Nothing recorded as visible yet." />
            ) : (
              data.sections.visible.map(renderPlainLine)
            )}

            {/* --- + You'll also need these --------------------------------------- */}
            <View style={styles.sectionHead}>
              <ThemedText type="section">You&apos;ll also need these</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {data.sections.order.length} parts
              </ThemedText>
            </View>
            {data.sections.order.length === 0 ? (
              <EmptyState message="Nothing else implied yet." />
            ) : (
              data.sections.order.map(renderPlainLine)
            )}

            {/* --- ? Check these when it comes apart ------------------------------- */}
            <View style={styles.sectionHead}>
              <ThemedText type="section">Check these when it&apos;s off</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {data.sections.check.length} to look at
              </ThemedText>
            </View>

            {data.sections.check.map((line) => {
              const open = expanded === line.part_id;
              return (
                <Framed key={line.part_id} style={styles.row}>
                  <View style={styles.rowHead}>
                    {line.inspection_rank != null ? (
                      <NumberBadge n={line.inspection_rank} />
                    ) : null}
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
                    <>
                      <Pressable
                        accessibilityRole="button"
                        onPress={() => setExpanded(open ? null : line.part_id)}
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
                    </>
                  ) : null}

                  {/* ✓ / ✗ are the only interaction: two taps, greasy hands. */}
                  {line.confirmed == null ? (
                    <View style={styles.answerRow}>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Confirm ${line.name} is damaged`}
                        disabled={busyId === line.part_id}
                        onPress={() => confirm(line, true)}
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
                        onPress={() => confirm(line, false)}
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
                </Framed>
              );
            })}

            {/* What the engine actually did, so the numbers are not a black box. */}
            {data.hidden_count != null ? (
              <ThemedText type="small" themeColor="textSecondary" style={styles.footnote}>
                {data.hidden_count.toLocaleString()} hidden parts scored from{' '}
                {data.candidates?.toLocaleString()} candidates in {data.computed_ms} ms.
              </ThemedText>
            ) : null}
          </ScrollView>

          <View style={[styles.footer, { borderTopColor: theme.border }]}>
            <View
              style={[
                styles.followUp,
                { backgroundColor: theme.backgroundElement, borderColor: theme.border },
              ]}
            >
              <TextInput
                value={followUp}
                onChangeText={setFollowUp}
                placeholder="Ask a follow-up…"
                placeholderTextColor={theme.textSecondary}
                onSubmitEditing={askFollowUp}
                returnKeyType="send"
                style={[styles.followUpInput, { color: theme.text }, NoFocusRing]}
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Send follow-up"
                onPress={askFollowUp}
                disabled={!followUp.trim() || asking}
                style={({ pressed }) => [
                  styles.followUpSend,
                  {
                    backgroundColor: followUp.trim() ? theme.accent : theme.backgroundSelected,
                    opacity: pressed ? 0.8 : 1,
                  },
                ]}
              >
                <Ionicons
                  name="arrow-up"
                  size={20}
                  color={followUp.trim() ? theme.accentText : theme.textSecondary}
                />
              </Pressable>
            </View>
          </View>
        </ThemedView>
      </KeyboardAvoidingView>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  padded: { padding: Spacing.three },
  list: { padding: Spacing.three, gap: Spacing.four, paddingBottom: Spacing.five },

  headerTitle: { alignItems: 'center' },
  headerButton: { paddingHorizontal: Spacing.two },

  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderRadius: Radius.round,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  statusText: { flex: 1, fontWeight: '600' },

  saidBlock: { gap: Spacing.two },
  saidChip: {
    alignSelf: 'flex-start',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.chip,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.half,
  },

  zonesCard: { gap: Spacing.two },

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
  },

  row: { gap: Spacing.two },
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

  footer: { padding: Spacing.three, borderTopWidth: StyleSheet.hairlineWidth },
  followUp: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.prompt,
    paddingLeft: Spacing.three,
    paddingRight: Spacing.two,
    paddingVertical: Spacing.two,
    minHeight: TapTarget,
  },
  followUpInput: { flex: 1, fontSize: 16, paddingVertical: Spacing.two },
  followUpSend: {
    width: 44,
    height: 44,
    borderRadius: Radius.prompt,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
