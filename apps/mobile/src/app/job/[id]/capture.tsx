/**
 * Screen 2 — live capture.
 *
 * The repairer walks around the car and talks. Each utterance is resolved against the
 * OEM catalogue by the API and appears in the visible damage list straight away.
 *
 * Voice is wired for recording but transcription is still a stub (see
 * `useVoiceCapture`), so the text box is the working input path today. Everything
 * downstream already runs off that text.
 */

import { useCallback, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Button, Card, EmptyState, ErrorNotice, Loading, Pill } from '@/components/ui';
import { NoFocusRing, Spacing } from '@/constants/theme';
import { toErrorInfo, useAsyncData } from '@/hooks/use-async-data';
import { useTheme } from '@/hooks/use-theme';
import { useVoiceCapture } from '@/hooks/use-voice-capture';
import { api } from '@/lib/api';

/** Lines the repairer has spoken or typed this session. */
interface TranscriptLine {
  id: string;
  text: string;
  resolvedTo: string | null;
  failed: boolean;
}

export default function CaptureScreen() {
  // `draft` is set when the entry screen could not match what was typed to a part —
  // it arrives here so the repairer can reword it rather than retype it.
  const { id: jobId, draft: carriedDraft } = useLocalSearchParams<{
    id: string;
    draft?: string;
  }>();
  const router = useRouter();
  const theme = useTheme();
  const voice = useVoiceCapture();

  const job = useAsyncData(() => api.getJob(jobId), [jobId]);

  const [transcript, setTranscript] = useState<TranscriptLine[]>([]);
  const [draft, setDraft] = useState(carriedDraft ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState<{ title: string; detail?: string } | null>(null);

  /** Send one utterance to the API and reflect the result in the transcript. */
  const submitText = useCallback(
    async (text: string, source: 'voice' | 'manual') => {
      const trimmed = text.trim();
      if (!trimmed || submitting) return;

      setSubmitting(true);
      setActionError(null);
      const lineId = `${Date.now()}`;
      setTranscript((prev) => [
        ...prev,
        { id: lineId, text: trimmed, resolvedTo: null, failed: false },
      ]);

      try {
        const item = await api.addDamage(jobId, trimmed, source);
        setTranscript((prev) =>
          prev.map((line) =>
            line.id === lineId ? { ...line, resolvedTo: item.displayName } : line,
          ),
        );
        setDraft('');
        await job.reload();
      } catch (err) {
        setTranscript((prev) =>
          prev.map((line) => (line.id === lineId ? { ...line, failed: true } : line)),
        );
        setActionError(toErrorInfo(err));
      } finally {
        setSubmitting(false);
      }
    },
    [jobId, job, submitting],
  );

  const toggleRecording = useCallback(async () => {
    if (voice.isRecording) {
      const text = await voice.stop();
      if (text) await submitText(text, 'voice');
    } else {
      await voice.start();
    }
  }, [voice, submitText]);

  const removeItem = useCallback(
    async (damageId: string) => {
      try {
        await api.removeDamage(jobId, damageId);
        await job.reload();
      } catch (err) {
        setActionError(toErrorInfo(err));
      }
    },
    [jobId, job],
  );

  if (job.loading) {
    return (
      <ThemedView style={styles.container}>
        <Loading label="Loading job…" />
      </ThemedView>
    );
  }

  if (!job.data) {
    return (
      <ThemedView style={styles.container}>
        <View style={styles.padded}>
          <ErrorNotice
            title={job.error?.title ?? 'Job not found'}
            detail={job.error?.detail}
          />
        </View>
      </ThemedView>
    );
  }

  const state = job.data;
  const error = actionError ?? job.error;
  const seconds = Math.floor(voice.durationMs / 1000);

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={90}
    >
      <ThemedView style={styles.container}>
        <ScrollView contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled">
          <View style={styles.header}>
            <ThemedText type="smallBold">
              {state.vehicle?.make.toUpperCase()} {state.vehicle?.model}
              {state.vehicle?.year ? ` · ${state.vehicle.year}` : ''}
            </ThemedText>
            <Pill label={state.status} />
          </View>

          {error ? <ErrorNotice title={error.title} detail={error.detail} /> : null}

          {/* --- recording control --- */}
          <Card>
            <Button
              title={voice.isRecording ? `Stop recording (${seconds}s)` : 'Start recording'}
              variant={voice.isRecording ? 'danger' : 'primary'}
              onPress={toggleRecording}
              loading={voice.status === 'transcribing'}
              disabled={voice.status === 'unavailable'}
              fullWidth
            />
            {voice.error ? (
              <ThemedText type="small" themeColor="textSecondary">
                {voice.error}
              </ThemedText>
            ) : (
              <ThemedText type="small" themeColor="textSecondary">
                Describe what you can see. Each part you name is matched to the catalogue.
              </ThemedText>
            )}
          </Card>

          {/* --- transcript --- */}
          <ThemedText type="smallBold">Transcript</ThemedText>
          <Card>
            {transcript.length === 0 ? (
              <ThemedText type="small" themeColor="textSecondary">
                Nothing captured yet.
              </ThemedText>
            ) : (
              transcript.map((line) => (
                <View key={line.id} style={styles.transcriptLine}>
                  <ThemedText type="small">“{line.text}”</ThemedText>
                  <ThemedText
                    type="small"
                    style={{ color: line.failed ? theme.danger : theme.textSecondary }}
                  >
                    {line.failed
                      ? 'no catalogue match'
                      : line.resolvedTo
                        ? `→ ${line.resolvedTo}`
                        : 'matching…'}
                  </ThemedText>
                </View>
              ))
            )}
          </Card>

          {/* --- text entry (the working input path until STT lands) --- */}
          <View style={styles.inputRow}>
            <TextInput
              value={draft}
              onChangeText={setDraft}
              placeholder="e.g. front bumper cover"
              placeholderTextColor={theme.textSecondary}
              onSubmitEditing={() => submitText(draft, 'manual')}
              returnKeyType="done"
              style={[
                styles.input,
                {
                  color: theme.text,
                  backgroundColor: theme.backgroundElement,
                  borderColor: theme.border,
                },
                NoFocusRing,
              ]}
            />
            <Button
              title="Add"
              onPress={() => submitText(draft, 'manual')}
              loading={submitting}
              disabled={!draft.trim()}
            />
          </View>

          {/* --- live visible damage list --- */}
          <View style={styles.sectionHeader}>
            <ThemedText type="smallBold">Visible damage</ThemedText>
            <Pill label={`${state.visibleDamage.length}`} tone="accent" />
          </View>

          {state.visibleDamage.length === 0 ? (
            <EmptyState message="Nothing yet. Name a damaged part to get started." />
          ) : (
            state.visibleDamage.map((item) => (
              <Card key={item.id} style={styles.damageCard}>
                <View style={styles.damageRow}>
                  <View style={styles.damageText}>
                    <ThemedText type="smallBold">{item.displayName}</ThemedText>
                    <ThemedText type="small" themeColor="textSecondary">
                      {item.manufacturerPartNumber ?? 'no part number'} · {item.source}
                    </ThemedText>
                  </View>
                  <Pressable onPress={() => removeItem(item.id)} accessibilityRole="button">
                    <ThemedText type="small" style={{ color: theme.danger }}>
                      Remove
                    </ThemedText>
                  </Pressable>
                </View>
              </Card>
            ))
          )}
        </ScrollView>

        <View style={[styles.footer, { borderTopColor: theme.border }]}>
          <Button
            title="Find hidden damage"
            onPress={() => router.push(`/job/${jobId}/hidden`)}
            disabled={state.visibleDamage.length === 0}
            fullWidth
          />
        </View>
      </ThemedView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  padded: { padding: Spacing.three },
  list: { padding: Spacing.three, gap: Spacing.three, paddingBottom: Spacing.five },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  transcriptLine: { gap: Spacing.half, paddingVertical: Spacing.half },
  inputRow: { flexDirection: 'row', gap: Spacing.two, alignItems: 'center' },
  input: {
    flex: 1,
    minHeight: 52,
    borderRadius: Spacing.three,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.three,
    fontSize: 16,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    marginTop: Spacing.two,
  },
  damageCard: { marginBottom: Spacing.two },
  damageRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  damageText: { flex: 1, gap: Spacing.half },
  footer: { padding: Spacing.three, borderTopWidth: StyleSheet.hairlineWidth },
});
