/**
 * Screen 3 — diagnosis.
 *
 * The report, in the three sections the backend buckets it into: what is visibly
 * damaged, what to order now, and what is worth walking over to check.
 *
 * Two things drive the interaction:
 *
 * - ✓ / ✗ on a `check` row calls /inspection/confirm, which returns a *complete
 *   replacement report*. There is no patching: the whole view swaps. That round
 *   trip is budgeted under 150 ms and touches no model, so it feels instant.
 * - The assistant asks at most one question at a time, ranked by how much the
 *   answer moves the report. Answering it also returns a full report.
 *
 * The follow-up box is the same capture loop as screen 2: whatever the repairer
 * adds becomes evidence, and everything is recomputed from scratch against it.
 */

import { useCallback, useMemo, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { formatProbability, type DamageReport, type ReportLine } from '@partli/shared';

import { Framed } from '@/components/framed';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import {
  Button,
  EmptyState,
  ErrorNotice,
  Loading,
  MatchBadge,
  NumberBadge,
  SectionLabel,
} from '@/components/ui';
import { VehicleZones, type ZoneMarker } from '@/components/vehicle-zones';
import { NoFocusRing, Radius, Spacing, TapTarget } from '@/constants/theme';
import { toErrorInfo, useAsyncData } from '@/hooks/use-async-data';
import { useTheme } from '@/hooks/use-theme';
import { api } from '@/lib/api';
import { zoneForPart } from '@/lib/zones';

export default function DiagnosisScreen() {
  const { id: caseId, said } = useLocalSearchParams<{ id: string; said?: string }>();
  const router = useRouter();
  const theme = useTheme();

  const report = useAsyncData(() => api.getReport(caseId), [caseId]);

  const [busyId, setBusyId] = useState<string | null>(null);
  const [followUp, setFollowUp] = useState('');
  const [asking, setAsking] = useState(false);
  const [answering, setAnswering] = useState(false);
  const [actionError, setActionError] = useState<{ title: string; detail?: string } | null>(null);

  const state: DamageReport | null = report.data ?? null;

  /** Every mutating call returns the whole report, so we swap rather than reload. */
  const swap = useCallback(
    (next: DamageReport) => {
      report.setData(next);
      setActionError(null);
    },
    [report],
  );

  const confirm = useCallback(
    async (line: ReportLine, damaged: boolean) => {
      setBusyId(line.part_id);
      try {
        swap(await api.confirm(caseId, line.part_id, damaged));
      } catch (err) {
        setActionError(toErrorInfo(err));
      } finally {
        setBusyId(null);
      }
    },
    [caseId, swap],
  );

  const answerQuestion = useCallback(
    async (questionId: string, value: string) => {
      setAnswering(true);
      try {
        swap(await api.answer(caseId, questionId, value));
      } catch (err) {
        setActionError(toErrorInfo(err));
      } finally {
        setAnswering(false);
      }
    },
    [caseId, swap],
  );

  /** A follow-up is just more evidence: send it, and the report recomputes. */
  const askFollowUp = useCallback(async () => {
    const text = followUp.trim();
    if (!text || asking) return;

    setAsking(true);
    try {
      await api.sendMessage(caseId, text);
      swap(await api.getReport(caseId));
      setFollowUp('');
    } catch (err) {
      setActionError(toErrorInfo(err));
    } finally {
      setAsking(false);
    }
  }, [followUp, asking, caseId, swap]);

  const sections = state?.sections;
  const check = useMemo(() => sections?.check ?? [], [sections]);
  const order = useMemo(() => sections?.order ?? [], [sections]);
  const visible = useMemo(() => sections?.visible ?? [], [sections]);

  /**
   * Markers for the silhouette. A part whose name gives no position away simply
   * gets no marker — see `lib/zones.ts`.
   */
  const markers = useMemo<ZoneMarker[]>(
    () =>
      check
        .map((line, i) => ({ n: i + 1, zone: zoneForPart(line.name) }))
        .filter((m): m is ZoneMarker => m.zone !== null),
    [check],
  );

  const vehicleTitle = state?.vehicle
    ? [state.vehicle.year, state.vehicle.make, state.vehicle.model].filter(Boolean).join(' ') ||
      state.vehicle.rego
    : 'Diagnosis';

  /** The repairer's own words if the entry screen passed them, else what we can see. */
  const saidText = said ?? visible.map((line) => line.name).slice(0, 4).join(', ');

  const header = (
    <Stack.Screen
      options={{
        headerTitleAlign: 'center',
        headerTitle: () => (
          <View style={styles.headerTitle}>
            <ThemedText type="rowTitle">{vehicleTitle}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {state ? `${state.impact.zone} ${sideLabel(state.impact.side)}` : 'Diagnosis'}
            </ThemedText>
          </View>
        ),
        headerRight: () => (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Refresh the report"
            onPress={() => void report.reload()}
            hitSlop={12}
            style={styles.headerButton}
          >
            <Ionicons name="refresh" size={20} color={theme.accent} />
          </Pressable>
        ),
      }}
    />
  );

  if (report.loading) {
    return (
      <>
        {header}
        <ThemedView style={styles.container}>
          <Loading label="Propagating through the component graph…" />
        </ThemedView>
      </>
    );
  }

  if (!state) {
    return (
      <>
        {header}
        <ThemedView style={styles.container}>
          <View style={styles.padded}>
            <ErrorNotice title={report.error?.title ?? 'Case not found'} detail={report.error?.detail} />
          </View>
        </ThemedView>
      </>
    );
  }

  const error = actionError ?? report.error;

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
            {saidText ? (
              <View style={styles.saidBlock}>
                <View style={[styles.saidChip, { borderColor: theme.accent }]}>
                  <ThemedText type="small" style={{ color: theme.accent }}>
                    You said
                  </ThemedText>
                </View>
                <ThemedText>{saidText}</ThemedText>
              </View>
            ) : null}

            {/* No OEM catalogue: say so rather than showing a thin report as if it were complete. */}
            {state.degraded ? (
              <ErrorNotice
                title="No parts catalogue for this vehicle"
                detail="Predictions are class-level only — part numbers are not available."
              />
            ) : null}

            <Framed style={styles.zonesCard}>
              <SectionLabel>AFFECTED ZONES</SectionLabel>
              <VehicleZones markers={markers} />
            </Framed>

            {error ? <ErrorNotice title={error.title} detail={error.detail} /> : null}

            {/* One question at a time, whichever moves the report most. */}
            {state.question ? (
              <Framed style={styles.question}>
                <SectionLabel>
                  {state.question.source === 'repairer' ? 'YOU RAISED THIS' : 'ONE QUESTION'}
                </SectionLabel>
                <ThemedText type="rowTitle">{state.question.text}</ThemedText>
                <View style={styles.questionRow}>
                  {state.question.options.map((option) => (
                    <Pressable
                      key={option}
                      accessibilityRole="button"
                      disabled={answering}
                      onPress={() => answerQuestion(state.question!.id, option)}
                      style={({ pressed }) => [
                        styles.questionButton,
                        { borderColor: theme.accent, opacity: pressed || answering ? 0.6 : 1 },
                      ]}
                    >
                      <ThemedText type="smallBold" style={{ color: theme.accent }}>
                        {option}
                      </ThemedText>
                    </Pressable>
                  ))}
                </View>
              </Framed>
            ) : null}

            {/* --- worth checking ------------------------------------------ */}
            <ThemedText type="section">Worth checking</ThemedText>

            {check.length === 0 ? (
              <EmptyState message="Nothing uncertain left. Everything else is either confirmed or ruled out." />
            ) : null}

            {check.map((line, i) => (
              <Framed key={line.part_id} style={styles.row}>
                <View style={styles.rowHead}>
                  <NumberBadge n={i + 1} />
                  <ThemedText type="rowTitle" style={styles.rowName}>
                    {line.name}
                  </ThemedText>
                  <MatchBadge value={line.p} />
                </View>

                {line.reason ? (
                  <ThemedText type="small" themeColor="textSecondary">
                    {line.reason}
                  </ThemedText>
                ) : null}

                {/* Why the graph thinks so — the top cause is usually enough. */}
                {line.attribution?.length ? (
                  <ThemedText type="small" themeColor="textSecondary">
                    mostly from {line.attribution[0]!.cause} ({line.attribution[0]!.relation})
                  </ThemedText>
                ) : null}

                {line.accessible === false ? (
                  <ThemedText type="small" themeColor="textSecondary">
                    Needs more teardown to reach.
                  </ThemedText>
                ) : null}

                {/* ✓ / ✗ are the only interaction: two taps, greasy hands, no keyboard. */}
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
              </Framed>
            ))}

            {/* --- order now ----------------------------------------------- */}
            {order.length > 0 ? (
              <>
                <View style={styles.reviewedHeader}>
                  <SectionLabel>ORDER THESE TOO</SectionLabel>
                </View>
                {order.map((line) => (
                  <View key={line.part_id} style={styles.reviewedRow}>
                    <Ionicons name="cart-outline" size={18} color={theme.accent} />
                    <View style={styles.reviewedName}>
                      <ThemedText type="small" numberOfLines={1}>
                        {line.qty > 1 ? `${line.qty}× ` : ''}
                        {line.name}
                      </ThemedText>
                      {line.reason ? (
                        <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                          {line.reason}
                        </ThemedText>
                      ) : null}
                    </View>
                    <ThemedText type="small" themeColor="textSecondary">
                      {formatProbability(line.p)}
                    </ThemedText>
                  </View>
                ))}
              </>
            ) : null}

            {/* --- already visible ----------------------------------------- */}
            {visible.length > 0 ? (
              <>
                <View style={styles.reviewedHeader}>
                  <SectionLabel>ALREADY VISIBLE</SectionLabel>
                </View>
                {visible.map((line) => (
                  <View key={line.part_id} style={styles.reviewedRow}>
                    <Ionicons name="checkmark-circle" size={18} color={theme.success} />
                    <ThemedText type="small" style={styles.reviewedName} numberOfLines={1}>
                      {line.qty > 1 ? `${line.qty}× ` : ''}
                      {line.name}
                    </ThemedText>
                    <ThemedText type="small" style={{ color: theme.success }}>
                      {formatProbability(line.p)}
                    </ThemedText>
                  </View>
                ))}
              </>
            ) : null}

            {typeof state.hidden_count === 'number' && state.hidden_count > 0 ? (
              <ThemedText type="small" themeColor="textSecondary">
                {state.hidden_count} more parts scored below the reporting threshold.
              </ThemedText>
            ) : null}
          </ScrollView>

          <View style={[styles.footer, { borderTopColor: theme.border }]}>
            <Button
              title="View 3D inspection"
              variant="secondary"
              onPress={() => router.push(`/job/${caseId}/inspection`)}
              fullWidth
            />
            <Button
              title="Send to customer"
              onPress={() => router.push(`/job/${caseId}/send`)}
              disabled={visible.length === 0 && order.length === 0}
              fullWidth
            />

            <View
              style={[
                styles.followUp,
                { backgroundColor: theme.backgroundElement, borderColor: theme.border },
              ]}
            >
              <TextInput
                value={followUp}
                onChangeText={setFollowUp}
                placeholder="Add what else you can see…"
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

function sideLabel(side: string): string {
  if (side === 'L') return 'left';
  if (side === 'R') return 'right';
  if (side === 'both') return 'both sides';
  return '';
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  padded: { padding: Spacing.three },
  list: { padding: Spacing.three, gap: Spacing.four, paddingBottom: Spacing.five },

  headerTitle: { alignItems: 'center' },
  headerButton: { paddingHorizontal: Spacing.two },

  saidBlock: { gap: Spacing.two },
  saidChip: {
    alignSelf: 'flex-start',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.chip,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.half,
  },

  zonesCard: { gap: Spacing.two },

  question: { gap: Spacing.two },
  questionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two, marginTop: Spacing.one },
  questionButton: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: TapTarget - 8,
    paddingHorizontal: Spacing.three,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.prompt,
  },

  row: { gap: Spacing.two },
  rowHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  rowName: { flex: 1 },

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

  reviewedHeader: { marginTop: Spacing.two },
  reviewedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.one,
  },
  reviewedName: { flex: 1 },

  footer: {
    padding: Spacing.three,
    gap: Spacing.two,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
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
    width: 40,
    height: 40,
    borderRadius: Radius.prompt,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
