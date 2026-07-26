/**
 * Deep link to one case, used by the RECENT drawer.
 *
 * The primary flow never comes here — the entry screen holds the case inline so
 * describing the car and reading the report happen on one page. This exists so a
 * case can be reopened by id, and it renders the same `ResultsScreen` the flow
 * does, so there is nothing to keep in sync.
 */

import { Stack, useLocalSearchParams, useRouter } from 'expo-router';

import { ResultsScreen } from '@/components/system/results-screen';
import { ThemedView } from '@/components/themed-view';
import { useCase } from '@/hooks/use-case';

export default function CaseScreen() {
  const { id: caseId, vehicleId } = useLocalSearchParams<{
    id: string;
    vehicleId?: string;
  }>();
  const router = useRouter();

  const kase = useCase(caseId, vehicleId ?? null);

  return (
    <ThemedView style={{ flex: 1 }}>
      <Stack.Screen options={{ headerShown: false }} />
      <ResultsScreen
        report={kase.report}
        loading={kase.loading}
        vehicle={kase.vehicle}
        error={kase.error}
        busyId={kase.busyId}
        answering={kase.answering}
        onConfirm={kase.confirm}
        onAnswer={kase.answer}
        onBack={() => router.back()}
        onNewAssessment={() => router.replace('/')}
        onReviewAndConfirm={() => router.push(`/case/${caseId}/send`)}
      />
    </ThemedView>
  );
}
