/**
 * The whole assessment, on one screen.
 *
 * Modelled on the ChatGPT mobile app: a centred greeting above a composer that starts as a
 * pill and grows as you type. Submitting does **not** navigate — the greeting drops away,
 * the report renders in its place, and the composer settles to the bottom as the follow-up
 * input. Same route, same mounted component, so there is no push animation and no back
 * button between describing the car and reading the answer.
 *
 * `/case/[id]` still exists for the drawer's deep links; it renders the same view.
 */

import { useCallback, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';

import { CaseReportView } from '@/components/case-report';
import { Composer } from '@/components/composer';
import { RecentDrawer } from '@/components/recent-drawer';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { SuggestionRow } from '@/components/ui';
import { Radius, Spacing } from '@/constants/theme';
import { toErrorInfo, useAsyncData } from '@/hooks/use-async-data';
import { useCase, type ErrorInfo, type MediaFile } from '@/hooks/use-case';
import { useTheme } from '@/hooks/use-theme';
import { useVoiceCapture, type Recording } from '@/hooks/use-voice-capture';
import { backend, waitForVehicleReady } from '@/lib/backend';
import { rememberCase } from '@/lib/recent-cases';
import { resolveRego, type RegoMatch } from '@/lib/rego';

/** Pre-filled starter, so the demo does not depend on remembering the phrasing. */
const EXAMPLE = 'yaris front right hit, bumper hanging off';

export default function HomeScreen() {
  const router = useRouter();
  const theme = useTheme();
  const voice = useVoiceCapture();

  // Loaded in the background — the composer renders immediately either way.
  const vehicles = useAsyncData(async () => (await backend.listVehicles()).vehicles);

  const [draft, setDraft] = useState('');
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<ErrorInfo | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  /**
   * Captures taken before a case exists.
   *
   * `/audio/transcribe` and `/media/upload` both require a `case_id`, and a case needs a
   * resolved vehicle, which needs a rego — so a clip recorded on the home screen cannot be
   * sent yet. It is held here and uploaded the moment the case is created, which is what
   * lets the mic and the `+` work on the home screen at all.
   */
  const [pendingAudio, setPendingAudio] = useState<Recording | null>(null);
  const [pendingMedia, setPendingMedia] = useState<{
    kind: 'image' | 'video';
    files: MediaFile[];
  } | null>(null);

  /**
   * The live case. Null until the first submit — that is what switches the layout.
   *
   * `caseId` is null for the first second or two: the view flips as soon as the vehicle is
   * registered, so the status pill can report Track A while the catalogue loads. The case
   * itself cannot be created until then, because `POST /case` rejects an unresolved vehicle.
   */
  const [active, setActive] = useState<{
    caseId: string | null;
    vehicleId: string;
    said?: string;
  } | null>(null);

  const kase = useCase(active?.caseId ?? null, active?.vehicleId ?? null);

  const startable = (vehicles.data ?? []).filter((v) => v.has_catalogue);

  const begin = useCallback(async (match: RegoMatch) => {
    setStarting(true);
    setStartError(null);

    const said = match.remainder.trim();

    try {
      // Track A: rego → VIN → catalogue. Returns at once with status "resolving".
      const vehicle = await backend.registerVehicle(match.rego);

      // Flip the layout now, not after the catalogue lands — this is the whole point of
      // the parallel track. No navigation: the hero becomes the report in place.
      setActive({ caseId: null, vehicleId: vehicle.vehicle_id, said: said || undefined });
      setDraft('');

      // `POST /case` 409s on an unresolved vehicle, so the wait is mandatory.
      const ready =
        vehicle.status === 'resolving'
          ? await waitForVehicleReady(vehicle.vehicle_id)
          : vehicle;

      if (ready.status === 'not_found') {
        setStartError({
          title: `${match.rego} could not be resolved`,
          detail: 'The registration did not match a vehicle.',
        });
        return;
      }
      if (ready.status === 'resolving') {
        setStartError({
          title: 'The catalogue is taking longer than expected',
          detail: 'Pull the case up again from the menu once it has loaded.',
        });
        return;
      }

      const created = await backend.createCase(ready.vehicle_id);

      // Track B: the repairer's own words are the first evidence on the case.
      if (said) await backend.sendMessage(created.case_id, said);

      rememberCase({
        caseId: created.case_id,
        vehicleId: ready.vehicle_id,
        label: `${match.vehicle.make} ${match.vehicle.model} · ${match.rego}`,
        said: said || undefined,
      });

      setActive((prev) => (prev ? { ...prev, caseId: created.case_id } : prev));

      // Anything captured before the case existed goes up now, in the order it was taken.
      if (pendingAudio) {
        await kase.transcribeInto(created.case_id, pendingAudio.uri, pendingAudio.mimeType);
        setPendingAudio(null);
      }
      if (pendingMedia) {
        await kase.attachInto(created.case_id, pendingMedia.kind, pendingMedia.files);
        setPendingMedia(null);
      }
    } catch (err) {
      setStartError(toErrorInfo(err));
    } finally {
      setStarting(false);
    }
    // The pending captures must be in here: an empty array would close over their initial
    // nulls and silently drop a clip recorded before submit.
  }, [pendingAudio, pendingMedia, kase]);

  /** Submitting means "start a case" before there is one, and "follow up" after. */
  const submit = useCallback(() => {
    const text = draft.trim();
    if (!text || starting) return;

    if (active) {
      void kase.ask(text);
      setDraft('');
      return;
    }

    if (vehicles.loading) {
      setStartError({ title: 'Still loading vehicles — try again in a moment.' });
      return;
    }

    const match = resolveRego(text, vehicles.data ?? []);
    if (!match) {
      // With no picker on screen, the error has to say what is actually available.
      setStartError({
        title: 'Which vehicle is that?',
        detail: startable.length
          ? `Name it or give the rego. Available: ${startable
              .map((v) => `${v.make} ${v.model} (${v.rego})`)
              .join(', ')}.`
          : 'No vehicles with a parts catalogue were found. Is the backend running on 8080?',
      });
      return;
    }

    void begin(match);
  }, [draft, starting, active, kase, vehicles.loading, vehicles.data, startable, begin]);

  /**
   * Voice goes to the backend, not to the text box: `POST /v1/audio/transcribe` stores the
   * clip, runs ASR and turns the transcript into evidence.
   *
   * With a case open it uploads straight away. Without one it is held, because the endpoint
   * needs a `case_id` — `begin` sends it as soon as the case exists.
   */
  const toggleRecording = useCallback(async () => {
    if (voice.isRecording) {
      const clip = await voice.stop();
      if (!clip) return;
      if (active?.caseId) await kase.transcribe(clip.uri, clip.mimeType);
      else setPendingAudio(clip);
    } else {
      await voice.start();
    }
  }, [voice, active, kase]);

  /**
   * Photos or a walkaround video. The backend pulls keyframes from video and runs vision
   * over them, so the result lands as evidence the same way speech does.
   */
  const pickMedia = useCallback(async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setStartError({
        title: 'Photo library access denied',
        detail: 'Grant access in Settings to attach photos or a walkaround video.',
      });
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images', 'videos'],
      allowsMultipleSelection: true,
      // The backend caps a request at 10 files.
      selectionLimit: 10,
      videoMaxDuration: 120,
    });
    if (result.canceled || result.assets.length === 0) return;

    // One request carries one kind, so the first asset decides and the rest follow it.
    const kind: 'image' | 'video' = result.assets[0].type === 'video' ? 'video' : 'image';
    const files: MediaFile[] = result.assets
      .filter((asset) => (asset.type === 'video' ? kind === 'video' : kind === 'image'))
      .map((asset, i) => ({
        uri: asset.uri,
        name: asset.fileName ?? `upload-${i}.${kind === 'video' ? 'mp4' : 'jpg'}`,
        type: asset.mimeType ?? (kind === 'video' ? 'video/mp4' : 'image/jpeg'),
      }));

    if (active?.caseId) await kase.attachInto(active.caseId, kind, files);
    else setPendingMedia({ kind, files });
  }, [active, kase]);

  /** Back to a blank prompt without leaving the screen. */
  const reset = useCallback(() => {
    setActive(null);
    setDraft('');
    setStartError(null);
    setExpanded(null);
  }, []);

  const showVehicles = useCallback(() => {
    setStartError({
      title: startable.length ? 'Vehicles with a parts catalogue' : 'No catalogue vehicles found',
      detail: startable.length
        ? `${startable
            .map((v) => `${v.make} ${v.model} (${v.rego})`)
            .join(', ')}. Name one, or give its rego.`
        : 'Is the backend running on port 8080?',
    });
  }, [startable]);

  const composer = (
    <Composer
      value={draft}
      onChangeText={setDraft}
      onSubmit={submit}
      placeholder={
        kase.transcribing
          ? 'Transcribing…'
          : active
            ? 'Ask a follow-up…'
            : 'Describe the vehicle and damage'
      }
      busy={starting || kase.asking || kase.transcribing || kase.attaching}
      onMicPress={toggleRecording}
      micActive={voice.isRecording}
      micDisabled={voice.status === 'unavailable' || kase.transcribing}
      onPlusPress={pickMedia}
    />
  );

  const title = kase.vehicle
    ? [kase.vehicle.year, kase.vehicle.make, kase.vehicle.model].filter(Boolean).join(' ') ||
      kase.vehicle.rego
    : 'Partli';

  return (
    <>
      <Stack.Screen
        options={{
          title: active ? title : 'Partli',
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
            active ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Start a new case"
                onPress={reset}
                hitSlop={12}
                style={styles.headerButton}
              >
                <Ionicons name="add" size={26} color={theme.accent} />
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
          {active ? (
            // --- Report state: results fill the screen, composer pins to the bottom.
            <CaseReportView
              report={kase.report}
              // No case yet means Track A is still running, not that anything failed.
              loading={kase.loading || !active.caseId}
              vehicle={kase.vehicle}
              error={kase.error ?? startError}
              // The latest transcript wins, so the echo reflects what was just heard.
              said={kase.transcript ?? active.said}
              busyId={kase.busyId}
              answering={kase.answering}
              expanded={expanded}
              onToggleExpanded={setExpanded}
              onConfirm={kase.confirm}
              onAnswer={kase.answer}
            />
          ) : (
            // --- Hero state: centred greeting, composer, starters.
            <ScrollView
              contentContainerStyle={styles.heroScroll}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              <View style={styles.hero}>
                <ThemedText type="heading" style={styles.heading}>
                  What&apos;s going on with the car?
                </ThemedText>

                {composer}

                {/* Held captures. Without this a recording made here looks like it vanished,
                    since it cannot be sent until the vehicle is known. */}
                {pendingAudio || pendingMedia ? (
                  <View style={styles.pendingRow}>
                    {pendingAudio ? (
                      <View style={[styles.pendingChip, { borderColor: theme.accent }]}>
                        <Ionicons name="mic" size={14} color={theme.accent} />
                        <ThemedText type="small" style={{ color: theme.accent }}>
                          Voice note ready
                        </ThemedText>
                      </View>
                    ) : null}
                    {pendingMedia ? (
                      <View style={[styles.pendingChip, { borderColor: theme.accent }]}>
                        <Ionicons
                          name={pendingMedia.kind === 'video' ? 'videocam' : 'image'}
                          size={14}
                          color={theme.accent}
                        />
                        <ThemedText type="small" style={{ color: theme.accent }}>
                          {pendingMedia.files.length}{' '}
                          {pendingMedia.kind === 'video' ? 'video' : 'photo'}
                          {pendingMedia.files.length === 1 ? '' : 's'} ready
                        </ThemedText>
                      </View>
                    ) : null}
                    <ThemedText type="small" themeColor="textSecondary">
                      Name the vehicle to send
                    </ThemedText>
                  </View>
                ) : null}

                <View style={styles.suggestions}>
                  <SuggestionRow
                    icon="car-sport-outline"
                    label="Try an example walkaround"
                    onPress={() => setDraft(EXAMPLE)}
                  />
                  {/* Voice lives in the docked composer, because the transcribe endpoint
                      needs a case to attach the clip to. */}
                  <SuggestionRow
                    icon="keypad-outline"
                    label="Start from a rego"
                    onPress={() => setDraft('QMN16 ')}
                  />
                  <SuggestionRow
                    icon="list-outline"
                    label="Which vehicles can I assess?"
                    onPress={showVehicles}
                  />
                </View>

                {startError ? (
                  <View style={styles.error}>
                    <ThemedText type="small" style={{ color: theme.danger }}>
                      {startError.title}
                    </ThemedText>
                    {startError.detail ? (
                      <ThemedText type="small" themeColor="textSecondary" style={styles.errorDetail}>
                        {startError.detail}
                      </ThemedText>
                    ) : null}
                  </View>
                ) : null}
              </View>
            </ScrollView>
          )}

          {/* In the report state the composer is docked; in the hero state it sits inline
              above, so it must not be rendered twice. */}
          {active ? (
            <View style={[styles.dock, { borderTopColor: theme.border }]}>
              {composer}
              <View style={styles.dockLinks}>
                <Pressable
                  accessibilityRole="button"
                  disabled={!active.caseId}
                  onPress={() => router.push(`/case/${active.caseId}/inspection`)}
                  style={({ pressed }) => [styles.dockLink, { opacity: pressed ? 0.6 : 1 }]}
                >
                  <Ionicons name="cube-outline" size={16} color={theme.accent} />
                  <ThemedText type="smallBold" style={{ color: theme.accent }}>
                    3D inspection
                  </ThemedText>
                </Pressable>

                <Pressable
                  accessibilityRole="button"
                  disabled={!active.caseId}
                  onPress={() => router.push(`/case/${active.caseId}/send`)}
                  style={({ pressed }) => [styles.dockLink, { opacity: pressed ? 0.6 : 1 }]}
                >
                  <ThemedText type="smallBold" style={{ color: theme.accent }}>
                    Send to customer
                  </ThemedText>
                  <Ionicons name="chevron-forward" size={15} color={theme.accent} />
                </Pressable>
              </View>
            </View>
          ) : null}
        </ThemedView>
      </KeyboardAvoidingView>

      <RecentDrawer open={menuOpen} onClose={() => setMenuOpen(false)} />
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },

  heroScroll: { flexGrow: 1, justifyContent: 'center', padding: Spacing.three },
  hero: { width: '100%', maxWidth: 720, alignSelf: 'center' },
  heading: { textAlign: 'center', marginBottom: Spacing.four },
  suggestions: { marginTop: Spacing.four },

  pendingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: Spacing.two,
    marginTop: Spacing.three,
  },
  pendingChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.chip,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.half,
  },

  headerButton: { paddingHorizontal: Spacing.two },

  dock: {
    padding: Spacing.three,
    gap: Spacing.two,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  dockLinks: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  dockLink: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one, minHeight: 32 },

  error: { marginTop: Spacing.three, alignItems: 'center', gap: Spacing.half },
  errorDetail: { textAlign: 'center' },
});
