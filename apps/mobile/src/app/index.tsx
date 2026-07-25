/**
 * The whole assessment, on one screen, as a chat thread.
 *
 * Modelled on the ChatGPT mobile app, and the details that make it feel that way:
 *
 *  - the composer is pinned to the bottom and **never moves**. On a fresh screen the
 *    greeting sits above it; it does not start centred and then jump;
 *  - sending appends the repairer's words as a bubble in the thread. It does not navigate,
 *    and there is no back button between describing the car and reading the answer;
 *  - the assistant's answer is unstyled content in the flow, not a bubble — same as the
 *    reference. Only the repairer's own messages get a filled bubble;
 *  - one live answer, always last: confirming a part re-runs the whole prediction, so the
 *    answer updates in place rather than leaving stale copies in the history.
 */

import { useCallback, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';

import { CaseReportView, MessageBubble } from '@/components/case-report';
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
  const scroller = useRef<ScrollView>(null);

  // Loaded in the background — the composer renders immediately either way.
  const vehicles = useAsyncData(async () => (await backend.listVehicles()).vehicles);

  const [draft, setDraft] = useState('');
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<ErrorInfo | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  /** The repairer's side of the conversation, oldest first. */
  const [thread, setThread] = useState<string[]>([]);

  /**
   * Captures taken before a case exists.
   *
   * `/audio/transcribe` and `/media/upload` both need a `case_id`, and a case needs a
   * resolved vehicle, which needs a rego — so a clip recorded here cannot be sent yet. It is
   * held and uploaded the moment the case is created.
   */
  const [pendingAudio, setPendingAudio] = useState<Recording | null>(null);
  const [pendingMedia, setPendingMedia] = useState<{
    kind: 'image' | 'video';
    files: MediaFile[];
  } | null>(null);

  /**
   * The live case. `caseId` stays null for the first second or two: the thread starts as soon
   * as the vehicle is registered so progress is visible, but `POST /case` rejects an
   * unresolved vehicle.
   */
  const [active, setActive] = useState<{
    caseId: string | null;
    vehicleId: string;
  } | null>(null);

  const kase = useCase(active?.caseId ?? null, active?.vehicleId ?? null);
  const startable = (vehicles.data ?? []).filter((v) => v.has_catalogue);

  const scrollToEnd = useCallback(() => {
    requestAnimationFrame(() => scroller.current?.scrollToEnd({ animated: true }));
  }, []);

  const begin = useCallback(
    async (match: RegoMatch, said: string) => {
      setStarting(true);
      setStartError(null);

      try {
        // Track A: rego → VIN → catalogue. Returns at once with status "resolving".
        const vehicle = await backend.registerVehicle(match.rego);
        setActive({ caseId: null, vehicleId: vehicle.vehicle_id });

        const ready =
          vehicle.status === 'resolving' ? await waitForVehicleReady(vehicle.vehicle_id) : vehicle;

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
            detail: 'Reopen the case from the menu once it has loaded.',
          });
          return;
        }

        const created = await backend.createCase(ready.vehicle_id);
        if (said) await backend.sendMessage(created.case_id, said);

        rememberCase({
          caseId: created.case_id,
          vehicleId: ready.vehicle_id,
          label: `${match.vehicle.make} ${match.vehicle.model} · ${match.rego}`,
          said: said || undefined,
        });

        setActive({ caseId: created.case_id, vehicleId: ready.vehicle_id });

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
      // The pending captures must be here: an empty array would close over their initial
      // nulls and silently drop a clip recorded before submit.
    },
    [pendingAudio, pendingMedia, kase],
  );

  /** Submitting means "start a case" before there is one, and "follow up" after. */
  const submit = useCallback(() => {
    const text = draft.trim();
    if (!text || starting) return;

    if (active) {
      setThread((prev) => [...prev, text]);
      setDraft('');
      scrollToEnd();
      void kase.ask(text);
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

    // The bubble shows what was actually typed, vehicle name and all.
    setThread([text]);
    setDraft('');
    void begin(match, match.remainder.trim());
  }, [draft, starting, active, kase, vehicles.loading, vehicles.data, startable, begin, scrollToEnd]);

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

  /** Back to a blank thread without leaving the screen. */
  const reset = useCallback(() => {
    setActive(null);
    setThread([]);
    setDraft('');
    setStartError(null);
    setExpanded(null);
    setPendingAudio(null);
    setPendingMedia(null);
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

  /**
   * One composer, placed in one of two spots.
   *
   * Centred with the greeting on a fresh screen — pinning it to the bottom there left a
   * screen-high void above it, which looked worse than the jump it was meant to avoid. Once
   * a conversation exists it docks at the bottom and stays put.
   */
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

  /** Captures held until a case exists. Sits next to whichever composer is on screen. */
  const pendingChips =
    pendingAudio || pendingMedia ? (
      <View style={styles.pendingRow}>
        {pendingAudio ? (
          <View style={[styles.pendingChip, { borderColor: theme.accent }]}>
            <Ionicons name="mic" size={13} color={theme.accent} />
            <ThemedText type="small" style={{ color: theme.accent }}>
              Voice note ready
            </ThemedText>
          </View>
        ) : null}
        {pendingMedia ? (
          <View style={[styles.pendingChip, { borderColor: theme.accent }]}>
            <Ionicons
              name={pendingMedia.kind === 'video' ? 'videocam' : 'image'}
              size={13}
              color={theme.accent}
            />
            <ThemedText type="small" style={{ color: theme.accent }}>
              {pendingMedia.files.length} {pendingMedia.kind === 'video' ? 'video' : 'photo'}
              {pendingMedia.files.length === 1 ? '' : 's'}
            </ThemedText>
          </View>
        ) : null}
        {!active ? (
          <ThemedText type="small" themeColor="textSecondary">
            Name the vehicle to send
          </ThemedText>
        ) : null}
      </View>
    ) : null;

  const title = active && kase.vehicle
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
          <ScrollView
            ref={scroller}
            contentContainerStyle={[styles.scroll, !active && styles.scrollEmpty]}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            onContentSizeChange={active ? scrollToEnd : undefined}
          >
            {active ? (
              <View style={styles.thread}>
                {thread.map((text, i) => (
                  <MessageBubble key={`${i}-${text.slice(0, 12)}`} text={text} />
                ))}

                {/* The transcript comes back as the repairer's words too. */}
                {kase.transcript ? <MessageBubble text={kase.transcript} /> : null}

                <CaseReportView
                  report={kase.report}
                  // No case yet means Track A is still running, not that anything failed.
                  loading={kase.loading || !active.caseId}
                  vehicle={kase.vehicle}
                  error={kase.error ?? startError}
                  busyId={kase.busyId}
                  answering={kase.answering}
                  expanded={expanded}
                  onToggleExpanded={setExpanded}
                  onConfirm={kase.confirm}
                  onAnswer={kase.answer}
                />
              </View>
            ) : (
              // Fresh screen: greeting, composer and starters as one centred block.
              <View style={styles.hero}>
                <ThemedText type="heading" style={styles.heading}>
                  What&apos;s going on with the car?
                </ThemedText>

                {composer}
                {pendingChips}

                <View style={styles.suggestions}>
                  <SuggestionRow
                    icon="car-sport-outline"
                    label="Try an example walkaround"
                    onPress={() => setDraft(EXAMPLE)}
                  />
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
            )}
          </ScrollView>

          {/* Docked only once there is a conversation to sit under. */}
          {active ? (
            <View style={[styles.dock, { borderTopColor: theme.border }]}>
              {pendingChips}
              {composer}

              {active.caseId ? (
                <View style={styles.dockLinks}>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => router.push(`/case/${active.caseId}/inspection`)}
                    style={({ pressed }) => [styles.dockLink, { opacity: pressed ? 0.6 : 1 }]}
                  >
                    <Ionicons name="cube-outline" size={15} color={theme.accent} />
                    <ThemedText type="smallBold" style={{ color: theme.accent }}>
                      3D inspection
                    </ThemedText>
                  </Pressable>

                  <Pressable
                    accessibilityRole="button"
                    onPress={() => router.push(`/case/${active.caseId}/send`)}
                    style={({ pressed }) => [styles.dockLink, { opacity: pressed ? 0.6 : 1 }]}
                  >
                    <ThemedText type="smallBold" style={{ color: theme.accent }}>
                      Send to customer
                    </ThemedText>
                    <Ionicons name="chevron-forward" size={15} color={theme.accent} />
                  </Pressable>
                </View>
              ) : null}
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

  scroll: { padding: Spacing.three, paddingBottom: Spacing.four },
  // A fresh screen centres the whole block; the composer is part of it, not docked.
  scrollEmpty: { flexGrow: 1, justifyContent: 'center' },
  hero: { width: '100%', maxWidth: 720, alignSelf: 'center' },
  heading: { textAlign: 'center', marginBottom: Spacing.four },
  suggestions: { marginTop: Spacing.four },

  thread: { width: '100%', maxWidth: 720, alignSelf: 'center', gap: Spacing.three },

  headerButton: { paddingHorizontal: Spacing.two },

  dock: {
    padding: Spacing.three,
    gap: Spacing.two,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  dockLinks: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  dockLink: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one, minHeight: 30 },

  pendingRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: Spacing.two },
  pendingChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.chip,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.half,
  },

  error: { marginTop: Spacing.two, alignItems: 'center', gap: Spacing.half },
  errorDetail: { textAlign: 'center' },
});
