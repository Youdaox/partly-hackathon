/**
 * Screen 3 — hidden damage.
 *
 * Ranked predictions from the proximity-graph oracle, each with a confidence bar and
 * a Yes/No. Answering calls /oracle/confirm, which pins the stored confidence to
 * 1 or 0 and (on Yes) promotes the part onto the visible damage list.
 */

import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import type { HiddenDamagePrediction, JobState } from '@partli/shared';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import {
  Button,
  Card,
  ConfidenceBar,
  EmptyState,
  ErrorNotice,
  Loading,
  Pill,
} from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { toErrorInfo, useAsyncData } from '@/hooks/use-async-data';
import { useTheme } from '@/hooks/use-theme';
import { api } from '@/lib/api';

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

export default function HiddenDamageScreen() {
  const { id: jobId } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const theme = useTheme();

  const job = useAsyncData(() => loadWithPredictions(jobId), [jobId]);

  const [predicting, setPredicting] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
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

  if (job.loading) {
    return (
      <ThemedView style={styles.container}>
        <Loading label="Scoring the proximity graph…" />
      </ThemedView>
    );
  }

  if (!job.data) {
    return (
      <ThemedView style={styles.container}>
        <View style={styles.padded}>
          <ErrorNotice title={job.error?.title ?? 'Job not found'} detail={job.error?.detail} />
        </View>
      </ThemedView>
    );
  }

  const state = job.data;
  const error = actionError ?? job.error;
  const unreviewed = state.hiddenDamage.filter((p) => p.confirmed === null);
  const reviewed = state.hiddenDamage.filter((p) => p.confirmed !== null);
  const confirmedCount = reviewed.filter((p) => p.confirmed === true).length;

  return (
    <ThemedView style={styles.container}>
      <ScrollView contentContainerStyle={styles.list}>
        <ThemedText type="small" themeColor="textSecondary">
          Parts likely damaged but not yet visible, ranked by how strongly they connect to what
          you already found.
        </ThemedText>

        {error ? <ErrorNotice title={error.title} detail={error.detail} /> : null}

        {predicting ? <Loading label="Re-scoring…" /> : null}

        {!predicting && state.hiddenDamage.length === 0 ? (
          <EmptyState message="No predictions yet. Run the oracle to see what might be hidden." />
        ) : null}

        {unreviewed.length > 0 ? (
          <View style={styles.sectionHeader}>
            <ThemedText type="smallBold">Needs review</ThemedText>
            <Pill label={`${unreviewed.length}`} tone="accent" />
          </View>
        ) : null}

        {unreviewed.map((prediction) => (
          <Card key={prediction.id} style={styles.card}>
            <ThemedText type="smallBold">{prediction.displayName}</ThemedText>
            <ConfidenceBar value={prediction.confidenceScore} />
            {prediction.reason ? (
              <ThemedText type="small" themeColor="textSecondary">
                {prediction.reason}
              </ThemedText>
            ) : null}
            <View style={styles.answerRow}>
              <View style={styles.answerButton}>
                <Button
                  title="Yes, damaged"
                  variant="success"
                  onPress={() => answer(prediction, true)}
                  loading={busyId === prediction.id}
                  fullWidth
                />
              </View>
              <View style={styles.answerButton}>
                <Button
                  title="No"
                  variant="secondary"
                  onPress={() => answer(prediction, false)}
                  disabled={busyId === prediction.id}
                  fullWidth
                />
              </View>
            </View>
          </Card>
        ))}

        {reviewed.length > 0 ? (
          <View style={styles.sectionHeader}>
            <ThemedText type="smallBold">Reviewed</ThemedText>
            <Pill label={`${confirmedCount} confirmed`} tone="success" />
          </View>
        ) : null}

        {reviewed.map((prediction) => (
          <Card key={prediction.id} style={styles.card}>
            <View style={styles.reviewedRow}>
              <ThemedText type="smallBold" style={styles.reviewedName}>
                {prediction.displayName}
              </ThemedText>
              <ThemedText
                type="small"
                style={{ color: prediction.confirmed ? theme.success : theme.textSecondary }}
              >
                {prediction.confirmed ? 'Confirmed' : 'Ruled out'}
              </ThemedText>
            </View>
          </Card>
        ))}

        <Button
          title={state.hiddenDamage.length === 0 ? 'Run the oracle' : 'Re-run with what I confirmed'}
          variant="secondary"
          onPress={runOracle}
          loading={predicting}
          fullWidth
        />
        <ThemedText type="small" themeColor="textSecondary" style={styles.footnote}>
          Re-running uses your confirmations as new starting points. Answers you have already
          given are kept.
        </ThemedText>
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
      </View>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  padded: { padding: Spacing.three },
  list: { padding: Spacing.three, gap: Spacing.three, paddingBottom: Spacing.five },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    marginTop: Spacing.two,
  },
  card: { gap: Spacing.two },
  answerRow: { flexDirection: 'row', gap: Spacing.two, marginTop: Spacing.one },
  answerButton: { flex: 1 },
  reviewedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  reviewedName: { flex: 1 },
  footnote: { textAlign: 'center' },
  footer: { padding: Spacing.three, gap: Spacing.two, borderTopWidth: StyleSheet.hairlineWidth },
});
