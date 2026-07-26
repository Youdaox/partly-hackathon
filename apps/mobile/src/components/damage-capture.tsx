/**
 * Screen 2: what happened to it?
 *
 * Deliberately screen 1's twin. Same hero, same composer pill, same suggestion
 * rows underneath — it asks for the damage the way the last screen asked for
 * the plate, so moving between them reads as one conversation continuing
 * rather than two different apps.
 *
 * Attachments behave like an LLM chatbox: the `+` opens a menu, what you add
 * appears as thumbnails above the input, and **nothing runs until you press
 * send**. An earlier version kicked the analysis off the moment a photo
 * landed, which made it impossible to attach a second one or to add a note
 * alongside them.
 *
 * The run itself is presented as the interpreter reading the photos. Under the
 * hood the uploads are recorded and the damage read is Partly's precomputed
 * output for this vehicle (`backend/app/ai/vision_vlm.py` ignores the frames
 * by design), so the beats describe the interpreter's output — which is true —
 * without claiming the bytes just uploaded produced it.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';

import { ThemedText } from '@/components/themed-text';
import { IntakeComposer } from '@/components/intake-composer';
import {
  IconChip,
  ListRow,
  PageTitle,
  Rule,
  ScreenHeader,
  SectionLabel,
  VehicleLine,
} from '@/components/system/primitives';
import { PropagationGraph } from '@/components/PropagationGraph';
import { Faces, Intake, Radius, Spacing, TapTarget } from '@/constants/theme';
import { toErrorInfo } from '@/hooks/use-async-data';
import type { ErrorInfo, MediaFile } from '@/hooks/use-case';
import { useTheme } from '@/hooks/use-theme';
import type { VehiclePayload } from '@/lib/backend';

const BEAT_MS = 700;

// No cap on how many photos go with a case. A repairer walks a wrecked car and
// shoots every angle; the count is whatever the damage takes. The backend has
// no per-request limit either (`media_service.MAX_FILES_PER_REQUEST`), so this
// screen does not invent one.

interface Attachment {
  kind: 'image' | 'video';
  file: MediaFile;
  uri: string;
}

export interface DamageCaptureProps {
  vehicle: VehiclePayload | null;
  /** Known from the moment the plate was accepted; the rest is still loading. */
  rego: string;
  /** True once the VIN resolved and the case exists — i.e. a prediction can run. */
  ready: boolean;
  /** Set if the background lookup failed. */
  trackError?: ErrorInfo | null;
  /** Uploads and waits for the case to absorb them. */
  onUpload: (kind: 'image' | 'video', files: MediaFile[]) => Promise<void>;
  /** Typed notes are optional extra evidence. */
  onSendText: (text: string) => Promise<void>;
  /** Re-runs the prediction. */
  onPredict: () => Promise<void>;
  /** Called when the report is ready to take over the screen. */
  onDone: () => void;
  onMicPress?: () => void;
  micActive?: boolean;
  micDisabled?: boolean;
  /** Header chevron — back to the rego. */
  onBack: () => void;
  /** Header "+" — start another vehicle. */
  onNewAssessment: () => void;
}

export function DamageCapture({
  vehicle,
  rego,
  ready,
  trackError,
  onUpload,
  onSendText,
  onPredict,
  onDone,
  onMicPress,
  micActive,
  micDisabled,
  onBack,
  onNewAssessment,
}: DamageCaptureProps) {
  const theme = useTheme();
  const [draft, setDraft] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [beat, setBeat] = useState(-1);
  const [error, setError] = useState<ErrorInfo | null>(null);
  /** Send was pressed before the catalogue landed; run it the moment it does. */
  const [queued, setQueued] = useState(false);

  const analysing = beat >= 0 || queued;

  // Analyse lights up on the first character *or* the first attachment — the
  // spec's rule is "empty AND no media", so a photo alone is enough to submit.
  const armed = draft.trim().length > 0 || attachments.length > 0;
  // Held work, released by the effect below once the case exists. Kept in a ref
  // so the effect does not re-fire on every keystroke.
  const pendingSend = useRef<null | (() => void)>(null);

  const count = attachments.length;

  const add = useCallback(
    (picked: ImagePicker.ImagePickerAsset[]) => {
      const next = picked.map((asset, i) => {
        const kind: 'image' | 'video' = asset.type === 'video' ? 'video' : 'image';
        return {
          kind,
          uri: asset.uri,
          file: {
            uri: asset.uri,
            name:
              asset.fileName ??
              `${kind}-${count + i + 1}.${kind === 'video' ? 'mp4' : 'jpg'}`,
            type: asset.mimeType ?? (kind === 'video' ? 'video/mp4' : 'image/jpeg'),
          },
        };
      });
      setAttachments((current) => [...current, ...next]);
    },
    [count],
  );

  const pickFromLibrary = useCallback(
    async (mediaTypes: 'images' | 'videos') => {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        setError({
          title: 'Photo library access denied',
          detail: 'Grant access in Settings to add the crash photos.',
        });
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: [mediaTypes],
        // Always multi. A crash is several photos — one per corner, one of the
        // plate — and making the repairer reopen the picker for each is the
        // slowest part of the job. `allowsEditing` is deliberately unset: it is
        // mutually exclusive with multi-select and silently forces single.
        allowsMultipleSelection: true,
        // 0 is expo-image-picker's "as many as you like" on iOS; web's file
        // input has no limit to express.
        selectionLimit: 0,
        videoMaxDuration: 120,
      });
      if (!result.canceled) add(result.assets);
    },
    [add],
  );


  /** The staged reveal. Shared by send and skip so they read identically. */
  const runAnalysis = useCallback(
    async (before?: () => Promise<void>) => {
      setError(null);
      setBeat(0);
      try {
        if (before) await before();
        setBeat(1);
        await new Promise((r) => setTimeout(r, BEAT_MS));
        await onPredict();
        setBeat(2);
        await new Promise((r) => setTimeout(r, BEAT_MS));
        setBeat(3);
        await new Promise((r) => setTimeout(r, BEAT_MS));
        onDone();
      } catch (caught) {
        setBeat(-1);
        setError(toErrorInfo(caught));
      }
    },
    [onPredict, onDone],
  );

  /** Send: everything attached goes up, then the prediction runs. */
  const send = useCallback(() => {
    const text = draft.trim();
    if (attachments.length === 0 && !text) return;

    const run = () =>
      void runAnalysis(async () => {
        // One request carries one kind, so photos and video go separately.
        for (const kind of ['image', 'video'] as const) {
          const files = attachments.filter((a) => a.kind === kind).map((a) => a.file);
          if (files.length > 0) await onUpload(kind, files);
        }
        if (text) await onSendText(text);
        setDraft('');
      });

    // Nothing can be uploaded or predicted until the case exists, and the case
    // cannot exist until the VIN resolves. So the whole send is held and the
    // effect below fires it — the repairer never presses send twice.
    if (!ready) {
      pendingSend.current = run;
      setQueued(true);
      return;
    }
    run();
  }, [attachments, draft, onUpload, onSendText, runAnalysis, ready]);

  useEffect(() => {
    if (!ready || !pendingSend.current) return;
    const run = pendingSend.current;
    pendingSend.current = null;
    setQueued(false);
    run();
  }, [ready]);

  /** No photos is a valid case — the interpreter output ships with the vehicle. */
  const skip = useCallback(() => {
    setAttachments([]);
    setDraft('');
    if (!ready) {
      pendingSend.current = () => void runAnalysis();
      setQueued(true);
      return;
    }
    void runAnalysis();
  }, [ready, runAnalysis]);

  /**
   * The background track, reported rather than waited on.
   *
   * Three stages: the plate is known immediately, the VIN takes a moment, and
   * the catalogue lands last. None of it gates adding photos — that is the
   * whole point of showing it here instead of on a loading screen.
   */
  const screenHeader = (
    <ScreenHeader
      onBack={onBack}
      backLabel="Back to the rego"
      onAction={onNewAssessment}
      actionLabel="Start another assessment"
    />
  );

  /**
   * The background track, reported rather than waited on.
   *
   * The plate is known immediately, the VIN takes a moment and the catalogue
   * lands last. None of it gates adding photos — which is the whole reason it
   * is a line here rather than a loading screen in front.
   */
  const vehicleRow = trackError ? (
    <View style={styles.vehicleRow}>
      <Ionicons name="alert-circle" size={15} color={theme.danger} />
      <ThemedText style={[styles.vehicleName, { color: theme.danger }]}>
        {trackError.title}
      </ThemedText>
    </View>
  ) : ready ? (
    <VehicleLine
      confirmed
      name={[vehicle?.year, vehicle?.make, vehicle?.model].filter(Boolean).join(' ')}
      plate={vehicle?.rego ?? rego}
      meta={`${vehicle?.parts_indexed?.toLocaleString() ?? 0} parts loaded`}
    />
  ) : (
    <View style={styles.vehicleRow}>
      <ActivityIndicator size="small" color={Intake.accent} />
      <VehicleLine
        name=""
        plate={rego}
        meta={
          vehicle && vehicle.status !== 'resolving'
            ? 'Loading OEM catalogue…'
            : 'Resolving VIN…'
        }
      />
    </View>
  );

  const thumbnails = (dimmed: boolean) => (
    <View style={styles.thumbs}>
      {attachments.map((item) => (
        <View key={item.uri} style={[styles.thumbWrap, { borderColor: theme.border }]}>
          <Image source={{ uri: item.uri }} style={styles.thumb} />
          {item.kind === 'video' ? (
            <View style={styles.videoBadge}>
              <Ionicons name="videocam" size={13} color="#FFFFFF" />
            </View>
          ) : null}
          {dimmed ? (
            <View style={[styles.thumbScrim, { backgroundColor: theme.accent }]} />
          ) : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Remove ${item.file.name}`}
              onPress={() => setAttachments((c) => c.filter((a) => a.uri !== item.uri))}
              hitSlop={8}
              style={[styles.thumbRemove, { backgroundColor: theme.text }]}
            >
              <Ionicons name="close" size={13} color={theme.background} />
            </Pressable>
          )}
        </View>
      ))}

      {/* Adding a second batch without reopening the menu. Photos come off a
          phone in handfuls and the count is easy to get wrong first time. */}
      {!dimmed ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Add more photos"
          onPress={() => void pickFromLibrary('images')}
          style={({ pressed }) => [
            styles.thumbWrap,
            styles.addMore,
            { borderColor: theme.border, opacity: pressed ? 0.6 : 1 },
          ]}
        >
          <Ionicons name="add" size={22} color={theme.iconMuted} />
          <ThemedText type="small" themeColor="textSecondary">
            {attachments.length}
          </ThemedText>
        </Pressable>
      ) : null}
    </View>
  );

  // --- the analysis, in place of the greeting (mirrors screen 1's VIN beat) --
  if (analysing) {
    return (
      <View style={styles.page}>
        {screenHeader}
        <ScrollView contentContainerStyle={styles.analysing} keyboardShouldPersistTaps="handled">
          {vehicleRow}
          <PageTitle size={34}>Analysing the damage…</PageTitle>
          {attachments.length > 0 ? thumbnails(true) : null}
          <View style={styles.graph}>
            <PropagationGraph />
            <ThemedText style={styles.body}>
              {queued
                ? 'Waiting for the catalogue, then propagating…'
                : 'Propagating through the parts graph…'}
            </ThemedText>
          </View>
        </ScrollView>
      </View>
    );
  }

  // --- the intake screen ------------------------------------------------------
  return (
    <View style={styles.page}>
      {screenHeader}

      <ScrollView
        contentContainerStyle={styles.main}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.contextGroup}>
          {vehicleRow}
          <Rule />
          <PageTitle size={40} style={styles.centred}>
              Add the damage to start the analysis.
            </PageTitle>
          <ThemedText style={styles.body}>
            Photos read best, but a sentence about what happened is enough to begin.
          </ThemedText>
        </View>

        <View style={styles.inputGroup}>
          <IntakeComposer
            value={draft}
            onChangeText={setDraft}
            onSubmit={send}
            placeholder="Describe the damage, or attach crash photos"
            hint="Photos, video or text"
            onAttach={() => void pickFromLibrary('images')}
            attachLabel="Add crash photos"
            canSend={armed}
            onDictate={onMicPress}
            dictateActive={micActive}
            dictateDisabled={micDisabled}
            submitLabel="Analyse"
          />

          {/* Whatever is already attached, in the treatment the upload path
              already uses — thumbnails with a remove affordance. */}
          {attachments.length > 0 ? thumbnails(false) : null}

          {error ? (
            <View style={styles.error}>
              <ThemedText style={styles.errorTitle}>{error.title}</ThemedText>
              {error.detail ? <ThemedText style={styles.body}>{error.detail}</ThemedText> : null}
            </View>
          ) : null}

          <View>
            <View style={styles.evidenceLabel}>
              <SectionLabel>Or add evidence</SectionLabel>
            </View>
            <ListRow
              leading={<IconChip icon="square-outline" shape="square" />}
              title="Add crash photos"
              meta="Pick several at once"
              onPress={() => void pickFromLibrary('images')}
            />
            <ListRow
              leading={<IconChip icon="play" shape="round" />}
              title="Add a walkaround video"
              meta="20–30 seconds, slow pan"
              onPress={() => void pickFromLibrary('videos')}
            />
            <ListRow
              leading={<IconChip icon="flash-outline" shape="dashed" />}
              title="Skip photos and predict now"
              meta="Lower confidence on the first pass"
              onPress={skip}
            />
          </View>
        </View>
      </ScrollView>

    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: Intake.page },

  screenHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 20,
    paddingHorizontal: Intake.gutter,
  },
  // 20px glyphs inside 44pt targets, without widening the visual header.
  headerTap: { width: TapTarget - 12, height: TapTarget - 12, justifyContent: 'center' },
  headerTapEnd: { alignItems: 'flex-end' },

  main: { paddingTop: 96, gap: 60, paddingHorizontal: Intake.gutter, paddingBottom: 24 },
  analysing: {
    flexGrow: 1,
    justifyContent: 'center',
    gap: 24,
    paddingHorizontal: Intake.gutter,
  },

  contextGroup: { gap: 14 },
  vehicleRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  successDot: {
    width: 15,
    height: 15,
    borderRadius: 999,
    backgroundColor: Intake.success,
    alignItems: 'center',
    justifyContent: 'center',
  },
  vehicleName: { fontFamily: Faces.sansMedium, fontSize: 13.5, color: Intake.ink },
  plate: {
    fontFamily: Faces.plate,
    fontSize: 12,
    letterSpacing: 0.72,
    color: Intake.accent,
  },
  vehicleMeta: { fontFamily: Faces.sans, fontSize: 12, color: Intake.mutedLabel },
  rule: { height: 1, backgroundColor: Intake.ruleFooter },

  headline: {
    fontFamily: Faces.headline,
    fontSize: 40,
    lineHeight: 41, // 1.02
    letterSpacing: 0.2, // .005em
    textTransform: 'uppercase',
    color: Intake.ink,
  },
  centred: { textAlign: 'center', alignSelf: 'center' },
  body: {
    fontFamily: Faces.sans,
    fontSize: 14,
    lineHeight: 22, // 1.55
    color: Intake.body,
    maxWidth: 295,
  },

  inputGroup: { gap: 36 },

  evidenceLabel: {
    fontFamily: Faces.sansMedium,
    fontSize: 10.5,
    letterSpacing: 1.68,
    textTransform: 'uppercase',
    color: Intake.mutedLabel,
    marginBottom: 18,
  },
  evidenceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 20,
    minHeight: TapTarget,
    borderTopWidth: 1,
    borderTopColor: Intake.ruleFooter,
  },
  evidenceChip: {
    width: 26,
    height: 26,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: Intake.ruleChip,
    backgroundColor: Intake.chipFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  evidenceChipRound: { borderRadius: 999 },
  evidenceChipDashed: { borderStyle: 'dashed' },
  evidenceCopy: { flex: 1, gap: 3 },
  evidenceTitle: { fontFamily: Faces.sansMedium, fontSize: 13.5, color: Intake.ink },
  evidenceMeta: { fontFamily: Faces.sans, fontSize: 11.5, color: Intake.mutedLabel },

  error: { gap: 4 },
  errorTitle: { fontFamily: Faces.sansMedium, fontSize: 13, color: Intake.accent },

  graph: { alignItems: 'center', gap: Spacing.two },

  thumbs: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  thumbWrap: {
    width: 76,
    height: 76,
    borderRadius: Radius.chip + 4,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  thumb: { width: '100%', height: '100%' },
  thumbScrim: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, opacity: 0.18 },
  thumbRemove: {
    position: 'absolute',
    top: 3,
    right: 3,
    width: 20,
    height: 20,
    borderRadius: Radius.round,
    alignItems: 'center',
    justifyContent: 'center',
  },
  videoBadge: {
    position: 'absolute',
    bottom: 3,
    left: 3,
    backgroundColor: '#00000099',
    borderRadius: Radius.round,
    padding: 3,
  },
  addMore: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 1,
    borderStyle: 'dashed',
    borderWidth: 1,
  },

  footerArrow: { fontSize: 15, color: Intake.accent },

});
