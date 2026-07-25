/**
 * Screen 1 — the entry screen.
 *
 * One prompt box, nothing else. The repairer says what they are looking at in a single
 * sentence — "yaris front right hit, bumper hanging off" — and lands in a live job: the
 * vehicle is resolved, the job created, the damage recorded.
 *
 * Deliberately empty below the input. The only thing that ever appears there is an
 * error, because otherwise a failed submit looks like nothing happened.
 */

import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { matchVehicle, type VehicleSummary } from '@partli/shared';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { NoFocusRing, Spacing } from '@/constants/theme';
import { toErrorInfo, useAsyncData } from '@/hooks/use-async-data';
import { useTheme } from '@/hooks/use-theme';
import { useVoiceCapture } from '@/hooks/use-voice-capture';
import { api } from '@/lib/api';

export default function EntryScreen() {
  const router = useRouter();
  const theme = useTheme();
  const voice = useVoiceCapture();

  // Loaded in the background — the input renders immediately either way.
  const vehicles = useAsyncData(() => api.listVehicles());

  const [draft, setDraft] = useState('');
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<{ title: string; detail?: string } | null>(null);

  const startable = (vehicles.data ?? []).filter((v) => v.hasCatalogue);

  const begin = useCallback(
    async (vehicle: VehicleSummary, damageText: string) => {
      setStarting(true);
      setError(null);

      try {
        // Seeding from the shipped AI prediction means the job opens already populated,
        // and anything typed is layered on top (the same part twice is an upsert).
        const job = await api.createJob(vehicle.slug, true);

        let unmatched: string | undefined;
        if (damageText.trim()) {
          try {
            await api.addDamage(job.id, damageText, 'voice');
          } catch {
            // No catalogue part matched the wording. Don't lose what they typed —
            // hand it to the capture screen so they can reword it there.
            unmatched = damageText;
          }
        }

        router.push({
          pathname: '/job/[id]/capture',
          params: unmatched ? { id: job.id, draft: unmatched } : { id: job.id },
        });
        setDraft('');
      } catch (err) {
        setError(toErrorInfo(err));
      } finally {
        setStarting(false);
      }
    },
    [router],
  );

  const submit = useCallback(() => {
    const text = draft.trim();
    if (!text || starting) return;

    if (vehicles.loading) {
      setError({ title: 'Still loading vehicles — try again in a moment.' });
      return;
    }

    const match = matchVehicle(text, startable, { requireCatalogue: true });
    if (!match) {
      // With no picker on screen, the error has to say what is actually available.
      setError({
        title: 'Which vehicle is that?',
        detail: startable.length
          ? `Name it in your sentence. Available: ${startable
              .map((v) => `${v.make} ${v.model}`)
              .join(', ')}.`
          : 'No vehicles with a parts catalogue were found. Is the API running?',
      });
      return;
    }

    void begin(match.vehicle, match.remainder);
  }, [draft, starting, vehicles.loading, startable, begin]);

  const toggleRecording = useCallback(async () => {
    if (voice.isRecording) {
      const text = await voice.stop();
      if (text) setDraft((prev) => (prev ? `${prev} ${text}` : text));
    } else {
      await voice.start();
    }
  }, [voice]);

  const hasText = draft.trim().length > 0;

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={90}
    >
      <ThemedView style={styles.container}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.hero}>
            <ThemedText style={styles.heading}>What are we looking at?</ThemedText>

            <View
              style={[
                styles.prompt,
                { backgroundColor: theme.background, borderColor: theme.border },
              ]}
            >
              <Ionicons name="add" size={24} color={theme.textSecondary} />

              <TextInput
                value={draft}
                onChangeText={setDraft}
                placeholder="Describe the vehicle and damage"
                placeholderTextColor={theme.textSecondary}
                onSubmitEditing={submit}
                returnKeyType="go"
                style={[styles.promptInput, { color: theme.text }, NoFocusRing]}
              />

              <Pressable
                onPress={toggleRecording}
                accessibilityRole="button"
                accessibilityLabel={voice.isRecording ? 'Stop recording' : 'Start recording'}
                disabled={voice.status === 'unavailable'}
                hitSlop={8}
                style={({ pressed }) => [
                  styles.micButton,
                  { opacity: voice.status === 'unavailable' ? 0.3 : pressed ? 0.5 : 1 },
                ]}
              >
                <Ionicons
                  name={voice.isRecording ? 'stop-circle' : 'mic-outline'}
                  size={22}
                  color={voice.isRecording ? theme.danger : theme.textSecondary}
                />
              </Pressable>

              <Pressable
                onPress={submit}
                accessibilityRole="button"
                accessibilityLabel="Start job"
                disabled={!hasText || starting}
                style={({ pressed }) => [
                  styles.submitButton,
                  {
                    backgroundColor: hasText ? theme.text : theme.backgroundSelected,
                    opacity: pressed ? 0.8 : 1,
                  },
                ]}
              >
                {starting ? (
                  <ActivityIndicator size="small" color={theme.background} />
                ) : (
                  <Ionicons
                    name="arrow-up"
                    size={20}
                    color={hasText ? theme.background : theme.textSecondary}
                  />
                )}
              </Pressable>
            </View>

            {/* The only thing that ever sits under the box. */}
            {error ? (
              <View style={styles.error}>
                <ThemedText type="small" style={{ color: theme.danger }}>
                  {error.title}
                </ThemedText>
                {error.detail ? (
                  <ThemedText type="small" themeColor="textSecondary" style={styles.errorDetail}>
                    {error.detail}
                  </ThemedText>
                ) : null}
              </View>
            ) : null}
          </View>
        </ScrollView>
      </ThemedView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { flexGrow: 1, justifyContent: 'center', padding: Spacing.three },
  // Keeps the box a readable width on a tablet or the web build.
  hero: { width: '100%', maxWidth: 720, alignSelf: 'center' },

  heading: {
    fontSize: 28,
    lineHeight: 36,
    fontWeight: '600',
    textAlign: 'center',
    marginBottom: Spacing.four,
  },

  prompt: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 28,
    paddingLeft: Spacing.three,
    paddingRight: Spacing.one,
    paddingVertical: Spacing.one,
    minHeight: 56,
    // Soft lift, the way the reference does it.
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  promptInput: {
    flex: 1,
    fontSize: 16,
    paddingVertical: Spacing.two,
  },
  micButton: { padding: Spacing.one },
  submitButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },

  error: { marginTop: Spacing.three, alignItems: 'center', gap: Spacing.half },
  errorDetail: { textAlign: 'center' },
});
