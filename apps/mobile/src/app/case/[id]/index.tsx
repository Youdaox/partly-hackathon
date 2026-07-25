/**
 * Deep link to one case, used by the RECENT drawer.
 *
 * The primary flow never comes here — the entry screen holds the case inline so describing
 * the car and reading the report happen on one page. This exists so a case can be reopened
 * by id, and it renders the same view and drives the same hook, so there is nothing to keep
 * in sync.
 */

import { useCallback, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { CaseReportView, MessageBubble } from '@/components/case-report';
import { Composer } from '@/components/composer';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useCase } from '@/hooks/use-case';
import { useTheme } from '@/hooks/use-theme';

export default function CaseScreen() {
  const { id: caseId, vehicleId, said } = useLocalSearchParams<{
    id: string;
    vehicleId?: string;
    said?: string;
  }>();
  const theme = useTheme();
  const router = useRouter();

  const kase = useCase(caseId, vehicleId ?? null);
  const [draft, setDraft] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);

  const submit = useCallback(() => {
    const text = draft.trim();
    if (!text) return;
    void kase.ask(text);
    setDraft('');
  }, [draft, kase]);

  const title = kase.vehicle
    ? [kase.vehicle.year, kase.vehicle.make, kase.vehicle.model].filter(Boolean).join(' ') ||
      kase.vehicle.rego
    : 'Diagnosis';

  return (
    <>
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
              onPress={kase.rerun}
              hitSlop={12}
              style={styles.headerButton}
            >
              <Ionicons name="ellipsis-horizontal" size={22} color={theme.accent} />
            </Pressable>
          ),
        }}
      />

      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={90}
      >
        <ThemedView style={styles.container}>
          {/* The report renders as a plain View now, so the scroll lives here. */}
          <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
            {said ? <MessageBubble text={said} /> : null}
            <CaseReportView
              report={kase.report}
              loading={kase.loading}
              vehicle={kase.vehicle}
              error={kase.error}
              busyId={kase.busyId}
              answering={kase.answering}
              expanded={expanded}
              onToggleExpanded={setExpanded}
              onConfirm={kase.confirm}
              onAnswer={kase.answer}
            />
          </ScrollView>

          <View style={[styles.dock, { borderTopColor: theme.border }]}>
            <Composer
              value={draft}
              onChangeText={setDraft}
              onSubmit={submit}
              placeholder="Ask a follow-up…"
              busy={kase.asking}
            />
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push(`/case/${caseId}/send`)}
              style={({ pressed }) => [styles.sendLink, { opacity: pressed ? 0.6 : 1 }]}
            >
              <ThemedText type="smallBold" style={{ color: theme.accent }}>
                Send to customer
              </ThemedText>
              <Ionicons name="chevron-forward" size={15} color={theme.accent} />
            </Pressable>
          </View>
        </ThemedView>
      </KeyboardAvoidingView>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { padding: Spacing.three, gap: Spacing.three },
  headerTitle: { alignItems: 'center' },
  headerButton: { paddingHorizontal: Spacing.two },
  dock: { padding: Spacing.three, gap: Spacing.two, borderTopWidth: StyleSheet.hairlineWidth },
  sendLink: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 2 },
});
