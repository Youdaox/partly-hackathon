/**
 * Screen 3 — diagnosis.
 *
 * Ranked predictions from the proximity-graph oracle: where they land on the vehicle,
 * then the list itself, each row carrying a match score and one line of plain English.
 * ✓ / ✗ calls /oracle/confirm, which pins the stored confidence to 1 or 0 and (on ✓)
 * promotes the part onto the visible damage list.
 *
 * The follow-up box at the bottom is the same capture loop as screen 2: whatever the
 * repairer adds becomes visible damage, then the oracle re-scores against it.
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
import type { HiddenDamagePrediction, JobState } from '@partli/shared';

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

/**
 * Load the job, and run the oracle straight away if it has not produced anything yet.
 * The repairer already pressed a button to get here, so make them press one fewer.
 */
async function loadWithPredictions(jobId: string): Promise<JobState> {
  const state = await api.getJob(jobId);
  if (state.hiddenDamage.length > 0 || state.visibleDamage.length === 0) return state;

  await api.predictHiddenDamage(jobId, 10);
  return api.getJob(jobId);
}

export default function DiagnosisScreen() {
  const {
    id: jobId,
    said,
    draft,
  } = useLocalSearchParams<{ id: string; said?: string; draft?: string }>();
  const router = useRouter();
  const theme = useTheme();

  const job = useAsyncData(() => loadWithPredictions(jobId), [jobId]);

  const [predicting, setPredicting] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  // `draft` is wording the entry screen could not match to a catalogue part. It arrives
  // pre-loaded in the follow-up box so the repairer can reword it instead of retyping.
  const [followUp, setFollowUp] = useState(draft ?? '');
  const [asking, setAsking] = useState(false);
  const [actionError, setActionError] = useState<{ title: string; detail?: string } | null>(null);

  const runOracle = useCallback(async () => {
    setPredicting(true);
    setActionError(null);
    try {
      await api.predictHiddenDamage(jobId, 10);
      await job.reload();
    } catch (err) {
      setActionError(toErrorInfo(err));
    } finally {
      setPredicting(false);
    }
  }, [jobId, job]);

  const answer = useCallback(
    async (prediction: HiddenDamagePrediction, confirmed: boolean) => {
      setBusyId(prediction.id);
      setActionError(null);
      try {
        await api.confirmHiddenDamage(jobId, prediction.id, confirmed);
        await job.reload();
      } catch (err) {
        setActionError(toErrorInfo(err));
      } finally {
        setBusyId(null);
      }
    },
    [jobId, job],
  );

  /** A follow-up is just more damage: record it, then re-score against it. */
  const askFollowUp = useCallback(async () => {
    const text = followUp.trim();
    if (!text || asking) return;

    setAsking(true);
    setActionError(null);
    try {
      await api.addDamage(jobId, text, 'voice');
      await api.predictHiddenDamage(jobId, 10);
      await job.reload();
      setFollowUp('');
    } catch (err) {
      setActionError(toErrorInfo(err));
    } finally {
      setAsking(false);
    }
  }, [followUp, asking, jobId, job]);

  const state = job.data;
  const unreviewed = useMemo(
    () => (state?.hiddenDamage ?? []).filter((p) => p.confirmed === null),
    [state],
  );
  const reviewed = useMemo(
    () => (state?.hiddenDamage ?? []).filter((p) => p.confirmed !== null),
    [state],
  );

  /**
   * Markers for the silhouette. Predictions carry a part name but not their diagram, so
   * a part whose name gives no position away simply gets no marker — see `lib/zones.ts`.
   */
  const markers = useMemo<ZoneMarker[]>(
    () =>
      unreviewed
        .map((p, i) => ({ n: i + 1, zone: zoneForPart(p.displayName) }))
        .filter((m): m is ZoneMarker => m.zone !== null),
    [unreviewed],
  );

  const vehicleTitle = state?.vehicle
    ? [state.vehicle.year, state.vehicle.make, state.vehicle.model].filter(Boolean).join(' ')
    : 'Diagnosis';

  /** The repairer's own words if the previous screen passed them, else what was captured. */
  const saidText =
    said ??
    (state?.visibleDamage ?? [])
      .filter((d) => d.source !== 'prediction')
      .map((d) => d.displayName)
      .join(', ');

  const header = (
    <Stack.Screen
      options={{
        headerTitleAlign: 'center',
        headerTitle: () => (
          <View style={styles.headerTitle}>
            <ThemedText type="rowTitle">{vehicleTitle}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              Diagnosis
            </ThemedText>
          </View>
        ),
        headerRight: () => (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Re-run predictions"
            onPress={runOracle}
            hitSlop={12}
            style={styles.headerButton}
          >
            <Ionicons name="ellipsis-horizontal" size={22} color={theme.accent} />
          </Pressable>
        ),
      }}
    />
  );

  if (job.loading) {
    return (
      <>
        {header}
        <ThemedView style={styles.container}>
          <Loading label="Scoring the proximity graph…" />
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
            <ErrorNotice title={job.error?.title ?? 'Job not found'} detail={job.error?.detail} />
          </View>
        </ThemedView>
      </>
    );
  }

  const error = actionError ?? job.error;

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

            <Framed style={styles.zonesCard}>
              <SectionLabel>AFFECTED ZONES</SectionLabel>
              <VehicleZones markers={markers} />
            </Framed>

            {error ? <ErrorNotice title={error.title} detail={error.detail} /> : null}

            <ThemedText type="section">Likely related parts</ThemedText>

            {predicting ? <Loading label="Re-scoring…" /> : null}

            {!predicting && state.hiddenDamage.length === 0 ? (
              <EmptyState message="No predictions yet. Describe more damage, or re-run from the header." />
            ) : null}

            {unreviewed.map((prediction, i) => (
              <Framed key={prediction.id} style={styles.row}>
                <View style={styles.rowHead}>
                  <NumberBadge n={i + 1} />
                  <ThemedText type="rowTitle" style={styles.rowName}>
                    {prediction.displayName}
                  </ThemedText>
                  <MatchBadge value={prediction.confidenceScore} />
                </View>

                {prediction.reason ? (
                  <ThemedText type="small" themeColor="textSecondary">
                    {prediction.reason}
                  </ThemedText>
                ) : null}

                {/* ✓ / ✗ are the only interaction: two taps, greasy hands, no keyboard. */}
                <View style={styles.answerRow}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Confirm ${prediction.displayName} is damaged`}
                    disabled={busyId === prediction.id}
                    onPress={() => answer(prediction, true)}
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
                    accessibilityLabel={`Rule out ${prediction.displayName}`}
                    disabled={busyId === prediction.id}
                    onPress={() => answer(prediction, false)}
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

            {reviewed.length > 0 ? (
              <View style={styles.reviewedHeader}>
                <SectionLabel>REVIEWED</SectionLabel>
              </View>
            ) : null}

            {reviewed.map((prediction) => (
              <View key={prediction.id} style={styles.reviewedRow}>
                <Ionicons
                  name={prediction.confirmed ? 'checkmark-circle' : 'close-circle-outline'}
                  size={18}
                  color={prediction.confirmed ? theme.success : theme.textSecondary}
                />
                <ThemedText type="small" style={styles.reviewedName} numberOfLines={1}>
                  {prediction.displayName}
                </ThemedText>
                <ThemedText
                  type="small"
                  style={{ color: prediction.confirmed ? theme.success : theme.textSecondary }}
                >
                  {prediction.confirmed ? 'Confirmed' : 'Ruled out'}
                </ThemedText>
              </View>
            ))}
          </ScrollView>

          <View style={[styles.footer, { borderTopColor: theme.border }]}>
            <Button
              title="View 3D inspection"
              variant="secondary"
              onPress={() => router.push(`/job/${jobId}/inspection`)}
              fullWidth
            />
            <Button
              title="Send to customer"
              onPress={() => router.push(`/job/${jobId}/send`)}
              disabled={state.visibleDamage.length === 0}
              fullWidth
            />

            {/* Self-clearing: the note goes as soon as they change the wording. */}
            {draft && followUp === draft ? (
              <ThemedText type="small" themeColor="textSecondary">
                No catalogue part matched “{draft}”. Try naming the panel or lamp directly.
              </ThemedText>
            ) : null}

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

  saidBlock: { gap: Spacing.two },
  saidChip: {
    alignSelf: 'flex-start',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.chip,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.half,
  },

  zonesCard: { gap: Spacing.two },

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
    minHeight: 36,
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
    width: 44,
    height: 44,
    borderRadius: Radius.prompt,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
