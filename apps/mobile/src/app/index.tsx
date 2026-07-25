/**
 * Screen 1 — the entry screen.
 *
 * One prompt box, nothing else above it. The repairer says what they are looking at in a
 * single sentence — "yaris front right hit, bumper's off" — and lands in a live job: the
 * vehicle is resolved, the job created, the damage recorded.
 *
 * Below the box are three tap-to-run starters. They exist because the sentence has to
 * name the car and there is no vehicle picker, so a repairer who types "bumper's off"
 * needs a way to find out what the app can actually assess.
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
import { Stack, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { matchVehicle, type VehicleSummary } from '@partli/shared';

import { Framed } from '@/components/framed';
import { RecentDrawer } from '@/components/recent-drawer';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { SuggestionRow } from '@/components/ui';
import { NoFocusRing, Radius, Spacing, TapTarget } from '@/constants/theme';
import { toErrorInfo, useAsyncData } from '@/hooks/use-async-data';
import { useTheme } from '@/hooks/use-theme';
import { useVoiceCapture } from '@/hooks/use-voice-capture';
import { api } from '@/lib/api';

/** Pre-filled starter, so the demo does not depend on remembering the phrasing. */
const EXAMPLE = 'yaris front right hit, bumper hanging off';

export default function EntryScreen() {
  const router = useRouter();
  const theme = useTheme();
  const voice = useVoiceCapture();

  // Loaded in the background — the input renders immediately either way.
  const vehicles = useAsyncData(() => api.listVehicles());

  const [draft, setDraft] = useState('');
  const [starting, setStarting] = useState(false);
  // VIN resolution takes a second or two, so say what is happening rather than spin.
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<{ title: string; detail?: string } | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  const startable = (vehicles.data ?? []).filter((v) => v.has_catalogue);

  const begin = useCallback(
    async (vehicle: VehicleSummary, damageText: string) => {
      setStarting(true);
      setError(null);

      const said = damageText.trim();

      try {
        // Registering the plate kicks off the VIN lookup; the case cannot open
        // until it lands, so `startCase` does that waiting for us. The case is
        // seeded from the shipped Interpreter output, so it opens populated.
        setStatus('Looking up the plate…');
        const { caseId } = await api.startCase(vehicle.rego, (vehicleStatus) => {
          setStatus(
            vehicleStatus === 'catalogue_ready'
              ? 'Loading the parts catalogue…'
              : 'Looking up the plate…',
          );
        });

        // Whatever they said about the damage is just a message on the case —
        // the same path a voice transcript takes.
        if (said) await api.sendMessage(caseId, said);

        // Straight to the diagnosis: the report is already computed on arrival.
        router.push({
          pathname: '/job/[id]/hidden',
          params: { id: caseId, ...(said ? { said } : {}) },
        });
        setDraft('');
      } catch (err) {
        setError(toErrorInfo(err));
      } finally {
        setStarting(false);
        setStatus(null);
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
          ? `Name it in your sentence, or read the plate. Available: ${startable
              .map((v) => `${v.make} ${v.model} (${v.rego})`)
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

  /** Third starter: answer the "which cars?" question without leaving the screen. */
  const showVehicles = useCallback(() => {
    setError({
      title: startable.length ? 'Vehicles with a parts catalogue' : 'No catalogue vehicles found',
      detail: startable.length
        ? `${startable
            .map((v) => `${v.make} ${v.model} (${v.rego})`)
            .join(', ')}. Name one, or read out its plate.`
        : 'Is the API running?',
    });
  }, [startable]);

  const hasText = draft.trim().length > 0;

  return (
    <>
      <Stack.Screen
        options={{
          title: 'Partli',
          headerTitleAlign: 'center',
          headerLeft: () => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Open recent jobs"
              onPress={() => setMenuOpen(true)}
              hitSlop={12}
              style={styles.headerButton}
            >
              <Ionicons name="menu" size={24} color={theme.accent} />
            </Pressable>
          ),
          headerRight: () => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="New job"
              onPress={() => {
                setDraft('');
                setError(null);
              }}
              hitSlop={12}
              style={styles.headerButton}
            >
              <Ionicons name="add" size={26} color={theme.accent} />
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
          <ScrollView
            contentContainerStyle={styles.scroll}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.hero}>
              <ThemedText type="heading" style={styles.heading}>
                What&apos;s going on with the car?
              </ThemedText>

              <Framed rules={false}>
                <View
                  style={[
                    styles.prompt,
                    { backgroundColor: theme.backgroundElement, borderColor: theme.border },
                  ]}
                >
                  <Ionicons name="add" size={24} color={theme.iconMuted} />

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
                      color={voice.isRecording ? theme.danger : theme.iconMuted}
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
                        backgroundColor: hasText ? theme.accent : theme.backgroundSelected,
                        opacity: pressed ? 0.8 : 1,
                      },
                    ]}
                  >
                    {starting ? (
                      <ActivityIndicator size="small" color={theme.accentText} />
                    ) : (
                      <Ionicons
                        name="arrow-up"
                        size={20}
                        color={hasText ? theme.accentText : theme.textSecondary}
                      />
                    )}
                  </Pressable>
                </View>
              </Framed>

              <View style={styles.suggestions}>
                <SuggestionRow
                  icon="car-sport-outline"
                  label="Try an example walkaround"
                  onPress={() => setDraft(EXAMPLE)}
                />
                <SuggestionRow
                  icon="mic-outline"
                  label="Describe the damage out loud"
                  onPress={toggleRecording}
                />
                <SuggestionRow
                  icon="list-outline"
                  label="Which vehicles can I assess?"
                  onPress={showVehicles}
                />
              </View>

              {status ? (
                <View style={styles.error}>
                  <ThemedText type="small" themeColor="textSecondary">
                    {status}
                  </ThemedText>
                </View>
              ) : null}

              {/* The only thing that ever sits under the starters. */}
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

      <RecentDrawer open={menuOpen} onClose={() => setMenuOpen(false)} />
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { flexGrow: 1, justifyContent: 'center', padding: Spacing.three },
  // Keeps the box a readable width on a tablet or the web build.
  hero: { width: '100%', maxWidth: 720, alignSelf: 'center' },

  headerButton: { paddingHorizontal: Spacing.two },

  heading: {
    textAlign: 'center',
    marginBottom: Spacing.four,
  },

  prompt: {
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
  promptInput: {
    flex: 1,
    fontSize: 16,
    paddingVertical: Spacing.two,
  },
  micButton: { padding: Spacing.one },
  submitButton: {
    width: 44,
    height: 44,
    borderRadius: Radius.prompt,
    alignItems: 'center',
    justifyContent: 'center',
  },

  suggestions: { marginTop: Spacing.four },

  error: { marginTop: Spacing.three, alignItems: 'center', gap: Spacing.half },
  errorDetail: { textAlign: 'center' },
});
