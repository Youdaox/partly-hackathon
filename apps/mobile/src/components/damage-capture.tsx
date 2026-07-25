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
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';

import { Composer } from '@/components/composer';
import { ThemedText } from '@/components/themed-text';
import { SuggestionRow } from '@/components/ui';
import { Radius, Spacing } from '@/constants/theme';
import { toErrorInfo } from '@/hooks/use-async-data';
import type { ErrorInfo, MediaFile } from '@/hooks/use-case';
import { useTheme } from '@/hooks/use-theme';
import type { VehiclePayload } from '@/lib/backend';

const BEATS = [
  'Storing what you added against the case',
  'Partly interpreter: reading the photos',
  'Visible damage identified',
  'Our engine: propagating through the parts graph',
];

const BEAT_MS = 700;

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
}: DamageCaptureProps) {
  const theme = useTheme();
  const [draft, setDraft] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [beat, setBeat] = useState(-1);
  const [error, setError] = useState<ErrorInfo | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  /** Send was pressed before the catalogue landed; run it the moment it does. */
  const [queued, setQueued] = useState(false);

  const analysing = beat >= 0 || queued;

  // Held work, released by the effect below once the case exists. Kept in a ref
  // so the effect does not re-fire on every keystroke.
  const pendingSend = useRef<null | (() => void)>(null);

  const add = useCallback((picked: ImagePicker.ImagePickerAsset[]) => {
    setAttachments((current) => [
      ...current,
      ...picked.map((asset, i) => {
        const kind: 'image' | 'video' = asset.type === 'video' ? 'video' : 'image';
        return {
          kind,
          uri: asset.uri,
          file: {
            uri: asset.uri,
            name:
              asset.fileName ??
              `${kind}-${current.length + i + 1}.${kind === 'video' ? 'mp4' : 'jpg'}`,
            type: asset.mimeType ?? (kind === 'video' ? 'video/mp4' : 'image/jpeg'),
          },
        };
      }),
    ]);
  }, []);

  const pickFromLibrary = useCallback(
    async (mediaTypes: 'images' | 'videos') => {
      setMenuOpen(false);
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
        allowsMultipleSelection: mediaTypes === 'images',
        // The backend caps a request at 10 files.
        selectionLimit: 10,
        videoMaxDuration: 120,
      });
      if (!result.canceled) add(result.assets);
    },
    [add],
  );

  const takePhoto = useCallback(async () => {
    setMenuOpen(false);
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      setError({
        title: 'Camera access denied',
        detail: 'Grant access in Settings to photograph the damage.',
      });
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'] });
    if (!result.canceled) add(result.assets);
  }, [add]);

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
  const header = (
    <View style={[styles.vehicleBar, { borderBottomColor: theme.border }]}>
      {trackError ? (
        <>
          <Ionicons name="alert-circle" size={16} color={theme.danger} />
          <ThemedText type="smallBold" style={{ color: theme.danger }}>
            {trackError.title}
          </ThemedText>
        </>
      ) : ready ? (
        <>
          <Ionicons name="checkmark-circle" size={16} color={theme.success} />
          <ThemedText type="smallBold" style={styles.vehicleName}>
            {[vehicle?.year, vehicle?.make, vehicle?.model].filter(Boolean).join(' ')}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {vehicle?.rego ?? rego} · {vehicle?.parts_indexed?.toLocaleString() ?? 0} parts
            loaded
          </ThemedText>
        </>
      ) : (
        <>
          <ActivityIndicator size="small" color={theme.accent} />
          <ThemedText type="smallBold">{rego}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {vehicle && vehicle.status !== 'resolving'
              ? 'Loading OEM catalogue…'
              : 'Resolving VIN…'}
          </ThemedText>
        </>
      )}
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
    </View>
  );

  // --- the analysis, in place of the greeting (mirrors screen 1's VIN beat) --
  if (analysing) {
    return (
      <ScrollView contentContainerStyle={styles.heroScroll} keyboardShouldPersistTaps="handled">
        <View style={styles.hero}>
          {header}
          <ThemedText type="heading" style={styles.heading}>
            Analysing the damage…
          </ThemedText>

          {attachments.length > 0 ? thumbnails(true) : null}

          {/* Sent early. The photos are held and the run starts by itself the
              instant the catalogue lands — nothing to press again. */}
          {queued ? (
            <View style={styles.beatRow}>
              <ActivityIndicator size="small" color={theme.accent} />
              <ThemedText type="smallBold">Analysing — waiting for the catalogue…</ThemedText>
            </View>
          ) : null}

          {queued ? null : (
            <View style={styles.beats}>
              {BEATS.map((label, index) => (
                <View key={label} style={styles.beatRow}>
                  {index < beat ? (
                    <Ionicons name="checkmark-circle" size={18} color={theme.success} />
                  ) : index === beat ? (
                    <ActivityIndicator size="small" color={theme.accent} />
                  ) : (
                    <Ionicons name="ellipse-outline" size={18} color={theme.border} />
                  )}
                  <ThemedText
                    type={index === beat ? 'smallBold' : 'small'}
                    themeColor={index <= beat ? 'text' : 'textSecondary'}
                  >
                    {label}
                  </ThemedText>
                </View>
              ))}
            </View>
          )}
        </View>
      </ScrollView>
    );
  }

  // --- the hero, same shape as the rego screen ------------------------------
  return (
    <ScrollView contentContainerStyle={styles.heroScroll} keyboardShouldPersistTaps="handled">
      <View style={styles.hero}>
        {header}

        <ThemedText type="heading" style={styles.heading}>
          Add the damage to start the analysis.
        </ThemedText>

        {/* Attachments sit above the input, the way they do in a chatbox. */}
        {attachments.length > 0 ? thumbnails(false) : null}

        <Composer
          value={draft}
          onChangeText={setDraft}
          onSubmit={send}
          placeholder="Add crash photos, or describe the damage"
          // Photos are the point of this screen, so the arrow lights up as soon
          // as one is attached — typing is optional, not the price of sending.
          canSend={attachments.length > 0 || draft.trim().length > 0}
          onPlusPress={() => setMenuOpen(true)}
          onMicPress={onMicPress}
          micActive={micActive}
          micDisabled={micDisabled}
        />

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

        <View style={styles.suggestions}>
          <SuggestionRow
            icon="images-outline"
            label="Add crash photos"
            onPress={() => void pickFromLibrary('images')}
          />
          <SuggestionRow
            icon="videocam-outline"
            label="Add a walkaround video"
            onPress={() => void pickFromLibrary('videos')}
          />
          <SuggestionRow
            icon="arrow-forward-outline"
            label="Skip photos and predict now"
            onPress={skip}
          />
        </View>
      </View>

      {/* The `+` menu: the same three ways in, from the composer. */}
      <Modal
        visible={menuOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setMenuOpen(false)}
      >
        <Pressable style={styles.backdrop} onPress={() => setMenuOpen(false)}>
          <View style={[styles.sheet, { backgroundColor: theme.background }]}>
            <SuggestionRow
              icon="images-outline"
              label="Photo library"
              onPress={() => void pickFromLibrary('images')}
            />
            <SuggestionRow
              icon="videocam-outline"
              label="Walkaround video"
              onPress={() => void pickFromLibrary('videos')}
            />
            <SuggestionRow
              icon="camera-outline"
              label="Take a photo"
              onPress={() => void takePhoto()}
            />
          </View>
        </Pressable>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  // Identical to the rego screen's hero, so screen 2 is visibly its twin.
  heroScroll: { flexGrow: 1, justifyContent: 'center', padding: Spacing.three },
  hero: { width: '100%', maxWidth: 720, alignSelf: 'center' },
  heading: { textAlign: 'center', marginBottom: Spacing.four },
  suggestions: { marginTop: Spacing.four },

  vehicleBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    flexWrap: 'wrap',
    gap: Spacing.two,
    paddingBottom: Spacing.three,
    marginBottom: Spacing.four,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  vehicleName: { flexShrink: 1 },

  thumbs: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
    marginBottom: Spacing.three,
  },
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

  beats: { gap: Spacing.three, paddingVertical: Spacing.three },
  beatRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },

  error: { marginTop: Spacing.three, alignItems: 'center', gap: Spacing.half },
  errorDetail: { textAlign: 'center' },

  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: '#00000055' },
  sheet: {
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.three,
    paddingBottom: Spacing.six,
    borderTopLeftRadius: Radius.card,
    borderTopRightRadius: Radius.card,
  },
});
