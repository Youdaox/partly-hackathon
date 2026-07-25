/**
 * The assessment, as three steps in one place.
 *
 *   1. rego   → the VIN, and that exact vehicle's OEM catalogue
 *   2. photos → the interpreter reads them, the graph propagates behind them
 *   3. report → visible damage, predicted damage, and the ✓/✗ loop
 *
 * The rego comes first and on its own. This screen used to open on a free-text
 * composer with three suggestion rows, which was flexible and unreadable: it
 * took a sentence, guessed a plate out of it, and gave a repairer no idea what
 * the app actually wanted. Worse, it buried the one thing the pitch depends on
 * — that the parts and their connections come out of the VIN *before* any
 * photo exists. Asking for the plate by itself makes that order visible.
 *
 * Still no navigation between the steps: same route, same mounted component,
 * so there is no push animation and no back button in the middle of a job.
 * `/case/[id]` renders the report directly for the drawer's deep links.
 */

import { useCallback, useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { CaseReportView } from '@/components/case-report';
import { Composer } from '@/components/composer';
import { DamageCapture } from '@/components/damage-capture';
import { RecentDrawer } from '@/components/recent-drawer';
import { RegoEntry } from '@/components/rego-entry';
import { Framed } from '@/components/framed';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { toErrorInfo } from '@/hooks/use-async-data';
import { useCase, type ErrorInfo, type MediaFile } from '@/hooks/use-case';
import { useTheme } from '@/hooks/use-theme';
import { useVoiceCapture } from '@/hooks/use-voice-capture';
import { backend, waitForVehicleReady } from '@/lib/backend';
import { rememberCase } from '@/lib/recent-cases';

/** Which of the three steps is on screen. */
type Step = 'rego' | 'photos' | 'report';

export default function HomeScreen() {
  const router = useRouter();
  const theme = useTheme();
  const voice = useVoiceCapture();

  const [step, setStep] = useState<Step>('rego');
  /** Set the moment the plate is accepted; the VIN is still unknown. */
  const [pending, setPending] = useState<{ vehicleId: string; rego: string } | null>(null);
  const [caseId, setCaseId] = useState<string | null>(null);
  const [track, setTrack] = useState<ErrorInfo | null>(null);
  const [draft, setDraft] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const kase = useCase(caseId, pending?.vehicleId ?? null);

  /**
   * Step 1 done — the plate was accepted, and that is all. The VIN, the
   * catalogue and the case are still to come; screen 2 opens now and the
   * lookup runs behind it.
   */
  const onRegistered = useCallback((vehicleId: string, rego: string) => {
    setPending({ vehicleId, rego });
    setCaseId(null);
    setTrack(null);
    setStep('photos');
  }, []);

  /**
   * The background track: poll until the VIN resolves, then open the case.
   *
   * `POST /case` 409s on an unresolved vehicle, so the case cannot exist until
   * this finishes — which is exactly why screen 2 has to cope with not having
   * one yet, and why a send pressed early is queued rather than refused.
   */
  useEffect(() => {
    if (!pending) return;
    let cancelled = false;

    (async () => {
      try {
        const ready = await waitForVehicleReady(pending.vehicleId);
        if (cancelled) return;
        if (ready.status !== 'catalogue_ready') {
          setTrack({
            title:
              ready.status === 'not_found'
                ? `${pending.rego} could not be resolved`
                : `${pending.rego} has no parts catalogue`,
            detail: 'Hidden damage cannot be predicted without one.',
          });
          return;
        }
        const created = await backend.createCase(ready.vehicle_id);
        if (cancelled) return;
        setCaseId(created.case_id);
        rememberCase({
          caseId: created.case_id,
          vehicleId: ready.vehicle_id,
          label: `${ready.make} ${ready.model} · ${ready.rego}`,
        });
      } catch (caught) {
        if (!cancelled) setTrack(toErrorInfo(caught));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [pending]);

  const uploadPhotos = useCallback(
    async (kind: 'image' | 'video', files: MediaFile[]) => {
      if (!caseId) return;
      await kase.attachInto(caseId, kind, files);
    },
    [caseId, kase],
  );

  /** A typed note on the damage screen is evidence, same as a transcript. */
  const sendNote = useCallback(
    async (text: string) => {
      if (!caseId) return;
      await backend.sendMessage(caseId, text);
    },
    [caseId],
  );

  /** Back to a blank plate without leaving the screen. */
  const reset = useCallback(() => {
    setPending(null);
    setCaseId(null);
    setTrack(null);
    setStep('rego');
    setDraft('');
    setExpanded(null);
  }, []);

  /** In the report step the composer is a follow-up, nothing more. */
  const askFollowUp = useCallback(() => {
    const text = draft.trim();
    if (!text) return;
    void kase.ask(text);
    setDraft('');
  }, [draft, kase]);

  const toggleRecording = useCallback(async () => {
    if (voice.isRecording) {
      const clip = await voice.stop();
      if (clip) await kase.transcribe(clip.uri, clip.mimeType);
    } else {
      await voice.start();
    }
  }, [voice, kase]);

  const title =
    step !== 'rego' && kase.vehicle
      ? [kase.vehicle.year, kase.vehicle.make, kase.vehicle.model].filter(Boolean).join(' ') ||
        kase.vehicle.rego
      : 'Partli';

  return (
    <>
      <Stack.Screen
        options={{
          title,
          headerTitleAlign: 'center',
          headerLeft: () => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Open recent cases"
              onPress={() => setMenuOpen(true)}
              hitSlop={12}
              style={styles.headerButton}
            >
              <Ionicons name="menu" size={24} color={theme.accent} />
            </Pressable>
          ),
          headerRight: () =>
            step !== 'rego' ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Start another vehicle"
                onPress={reset}
                hitSlop={12}
                style={styles.headerButton}
              >
                <Ionicons name="add" size={24} color={theme.accent} />
              </Pressable>
            ) : null,
        }}
      />

      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={90}
      >
        <ThemedView style={styles.container}>
          {step === 'rego' ? (
            // --- 1. which vehicle? ------------------------------------------
            <RegoEntry onRegistered={onRegistered} />
          ) : step === 'photos' && pending ? (
            // --- 2. the photos, and the analysis they start -----------------
            <DamageCapture
              vehicle={kase.vehicle}
              rego={pending.rego}
              ready={caseId !== null}
              trackError={track}
              onUpload={uploadPhotos}
              onSendText={sendNote}
              onPredict={kase.rerun}
              onDone={() => setStep('report')}
              onMicPress={toggleRecording}
              micActive={voice.isRecording}
              micDisabled={voice.status === 'unavailable' || kase.transcribing}
            />
          ) : (
            // --- 3. what was found ------------------------------------------
            <CaseReportView
              report={kase.report}
              loading={kase.loading}
              vehicle={kase.vehicle}
              error={kase.error}
              said={kase.transcript ?? undefined}
              busyId={kase.busyId}
              answering={kase.answering}
              expanded={expanded}
              onToggleExpanded={setExpanded}
              onConfirm={kase.confirm}
              onAnswer={kase.answer}
            />
          )}

          {/* The follow-up composer belongs to the report only: before there is
              a report there is nothing to follow up on, and offering a text box
              next to the plate field is what made the old screen ambiguous. */}
          {step === 'report' && caseId ? (
            <Framed style={styles.dock}>
              <Composer
                value={draft}
                onChangeText={setDraft}
                onSubmit={askFollowUp}
                placeholder={kase.transcribing ? 'Transcribing…' : 'Ask a follow-up…'}
                busy={kase.asking || kase.transcribing || kase.attaching}
                onMicPress={toggleRecording}
                micActive={voice.isRecording}
                micDisabled={voice.status === 'unavailable' || kase.transcribing}
              />
              <View style={styles.dockLinks}>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => router.push(`/case/${caseId}/inspection`)}
                  style={({ pressed }) => [styles.dockLink, { opacity: pressed ? 0.6 : 1 }]}
                >
                  <Ionicons name="cube-outline" size={16} color={theme.accent} />
                  <ThemedText type="smallBold" style={{ color: theme.accent }}>
                    3D inspection
                  </ThemedText>
                </Pressable>

                <Pressable
                  accessibilityRole="button"
                  onPress={() => router.push(`/case/${caseId}/send`)}
                  style={({ pressed }) => [styles.dockLink, { opacity: pressed ? 0.6 : 1 }]}
                >
                  <ThemedText type="smallBold" style={{ color: theme.accent }}>
                    Send to customer
                  </ThemedText>
                  <Ionicons name="chevron-forward" size={15} color={theme.accent} />
                </Pressable>
              </View>
            </Framed>
          ) : null}
        </ThemedView>
      </KeyboardAvoidingView>

      <RecentDrawer open={menuOpen} onClose={() => setMenuOpen(false)} />
    </>
  );
}


const styles = StyleSheet.create({
  container: { flex: 1 },
  headerButton: { paddingHorizontal: Spacing.two },

  // Crop-marked like the cards above it, so the composer reads as the last
  // block of the list rather than a separate toolbar bolted underneath.
  dock: {
    paddingHorizontal: Spacing.three,
    gap: Spacing.two,
  },
  dockLinks: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  dockLink: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one, minHeight: 32 },
});
