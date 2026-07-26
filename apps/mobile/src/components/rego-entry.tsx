/**
 * Screen 1: which vehicle?
 *
 * An editorial treatment rather than a form — paper-white, hairline rules, one
 * accent, a serif headline over a sans body. The rego is the only thing asked
 * for, and the screen is arranged so it is the only thing to look at.
 *
 * The plate goes in an underlined field rather than a box: a box implies a form
 * with more fields after it, and there are none. Field and button both take the
 * accent on the first character typed, so the screen answers before you finish.
 *
 * Send hands straight over to screen 2. It does *not* wait for the VIN:
 * `registerVehicle` returns immediately with status `resolving`, and resolving a
 * real catalogue takes long enough that a loading screen in front of it would be
 * dead time the repairer could have spent photographing the car. The lookup runs
 * behind screen 2 and reports itself on a status line there.
 */

import { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { IntakeComposer } from '@/components/intake-composer';
import {
  FooterBar,
  PageTitle,
  ScreenHeader,
  SectionLabel,
} from '@/components/system/primitives';
import { ThemedText } from '@/components/themed-text';
import { Faces, Intake, TapTarget } from '@/constants/theme';
import { toErrorInfo, useAsyncData } from '@/hooks/use-async-data';
import type { ErrorInfo } from '@/hooks/use-case';
import { backend } from '@/lib/backend';
import { listRecentCases } from '@/lib/recent-cases';

/** Recents are a shortcut, not a directory. */
const MAX_RECENTS = 3;

/** "2d ago" rather than a date — how long ago is the only part that matters. */
function agoLabel(iso: string | undefined): string {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const days = Math.floor((Date.now() - then) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return '1d ago';
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  return weeks < 5 ? `${weeks}w ago` : `${Math.floor(days / 30)}mo ago`;
}

export interface RegoEntryProps {
  /** Fired as soon as the plate is accepted — before the VIN comes back. */
  onRegistered: (vehicleId: string, rego: string) => void;
  /** The header's menu button; the drawer itself lives on the parent screen. */
  onOpenMenu: () => void;
  onDictate?: () => void;
  dictateActive?: boolean;
  dictateDisabled?: boolean;
}

export function RegoEntry({
  onRegistered,
  onOpenMenu,
  onDictate,
  dictateActive,
  dictateDisabled,
}: RegoEntryProps) {
  const [draft, setDraft] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<ErrorInfo | null>(null);

  const vehicles = useAsyncData(async () => (await backend.listVehicles()).vehicles);

  /**
   * The chips: vehicles this device has already opened, first.
   *
   * `listRecentCases` is the recents store, but it is in-memory and therefore
   * empty on a cold start — which is exactly when this screen is on display. So
   * recents *order* the list rather than being the list: anything opened before
   * floats to the top, and the catalogued vehicles fill the rest. The screen is
   * never blank, and "pick up where you left off" is true whenever there is
   * anything to pick up.
   */
  const recents = useMemo(() => {
    const startable = (vehicles.data ?? []).filter((vehicle) => vehicle.has_catalogue);
    // `label` is written as "Make Model · REGO" when a case is remembered.
    const openedAt = new Map<string, string>();
    for (const entry of listRecentCases()) {
      const plate = entry.label.split('·').pop()?.trim().toUpperCase();
      if (plate && !openedAt.has(plate)) openedAt.set(plate, entry.openedAt);
    }
    const rank = (rego: string) => {
      const seen = [...openedAt.keys()].indexOf(rego.toUpperCase());
      return seen === -1 ? Number.MAX_SAFE_INTEGER : seen;
    };
    return [...startable]
      .sort((a, b) => rank(a.rego) - rank(b.rego))
      .slice(0, MAX_RECENTS)
      .map((vehicle) => ({
        ...vehicle,
        // Only genuine recents have an age; the rest are here to fill the list
        // and saying "today" about them would be an invention.
        age: agoLabel(openedAt.get(vehicle.rego.toUpperCase())),
      }));
  }, [vehicles.data]);

  const lookUp = useCallback(
    async (plate: string) => {
      // Whatever is in the box is the rego. Punctuation and spaces are typing,
      // not part of a plate.
      const trimmed = plate.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
      if (!trimmed || submitting) return;

      setError(null);
      setSubmitting(true);
      try {
        // Returns at once with status `resolving`. Everything after this point
        // happens behind screen 2.
        const registered = await backend.registerVehicle(trimmed);
        onRegistered(registered.vehicle_id, trimmed);
      } catch (caught) {
        setError(toErrorInfo(caught));
      } finally {
        setSubmitting(false);
      }
    },
    [onRegistered, submitting],
  );

  /**
   * The composer's "+".
   *
   * Reading a plate off a photo needs OCR, and there is none — no endpoint and
   * no on-device model. Opening a picker that leads nowhere would be worse than
   * saying so, so the button explains itself and points at what does work.
   * Wire a plate reader in and this becomes the capture the spec describes.
   */
  const scanPlate = useCallback(() => {
    setError({
      title: 'Plate capture is not wired up yet',
      detail: 'Type the rego, or pick one of the recents below.',
    });
  }, []);

  const showAssessable = useCallback(() => {
    const startable = (vehicles.data ?? []).filter((vehicle) => vehicle.has_catalogue);
    setError({
      title: startable.length ? 'Vehicles with a parts catalogue' : 'No catalogue vehicles found',
      detail: startable.length
        ? `${startable
            .map((vehicle) => `${vehicle.make} ${vehicle.model} (${vehicle.rego})`)
            .join(', ')}. Type one of those regos.`
        : 'Is the backend running on port 8080?',
    });
  }, [vehicles.data]);

  return (
    <View style={styles.page}>
      <ScreenHeader onAction={onOpenMenu} actionLabel="Open recent cases" actionIcon="menu" />

      <ScrollView
        contentContainerStyle={styles.main}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.brandGroup}>
          {/* No wordmark asset ships yet, so it is set rather than drawn — the
              headline face at the mark's size. Swap for an SVG when one lands. */}
          <ThemedText style={styles.wordmark}>Partli</ThemedText>

          <View style={styles.copyGroup}>
            {/* One upright weight, one colour. The intake screen sets its
                headline the same way, and two screens a tap apart should not
                disagree about what a headline is. */}
            <PageTitle size={42}>Enter the rego to start.</PageTitle>
            <ThemedText style={styles.body}>
              One plate is enough. We&rsquo;ll bring up the vehicle and everything already
              known about it.
            </ThemedText>
          </View>
        </View>

        <View style={styles.inputGroup}>
          <IntakeComposer
            value={draft}
            onChangeText={setDraft}
            onSubmit={() => void lookUp(draft)}
            placeholder="Enter the rego number, e.g. QMN16"
            hint="Plate, VIN or photo"
            onAttach={scanPlate}
            attachLabel="Photograph or scan the plate"
            onDictate={onDictate}
            dictateActive={dictateActive}
            dictateDisabled={dictateDisabled}
            submitLabel="Continue"
          />

          {error ? (
            <View style={styles.error}>
              <ThemedText style={styles.errorTitle}>{error.title}</ThemedText>
              {error.detail ? <ThemedText style={styles.body}>{error.detail}</ThemedText> : null}
            </View>
          ) : null}

          <View>
            <View style={styles.recentsLabel}>
              <SectionLabel>Pick up where you left off</SectionLabel>
            </View>
            {recents.map((vehicle) => (
              <Pressable
                key={vehicle.rego}
                accessibilityRole="button"
                accessibilityLabel={`Continue with ${vehicle.rego}, ${vehicle.make} ${vehicle.model}`}
                // A recent goes straight through — the plate is already known,
                // so asking the repairer to press send again buys nothing.
                onPress={() => void lookUp(vehicle.rego)}
                style={({ pressed }) => [styles.recentRow, { opacity: pressed ? 0.6 : 1 }]}
              >
                <ThemedText style={styles.recentPlate}>{vehicle.rego}</ThemedText>
                <ThemedText style={styles.recentName}>
                  {vehicle.make} {vehicle.model}
                </ThemedText>
                {vehicle.age ? (
                  <ThemedText style={styles.recentAge}>{vehicle.age}</ThemedText>
                ) : null}
                <ThemedText style={styles.arrow}>→</ThemedText>
              </Pressable>
            ))}
          </View>
        </View>
      </ScrollView>

      <FooterBar
        label="Which vehicles can I assess?"
        action="→"
        onPress={showAssessable}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: Intake.page },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 20,
    paddingHorizontal: Intake.gutter,
  },
  eyebrow: {
    fontFamily: Faces.sansMedium,
    fontSize: 11,
    letterSpacing: 1.76, // .16em
    textTransform: 'uppercase',
    color: Intake.mutedLabel,
  },
  // 18x18 of bars inside a 44pt touch target.
  menuButton: {
    width: TapTarget - 12,
    height: TapTarget - 12,
    alignItems: 'flex-end',
    justifyContent: 'center',
    gap: 4,
  },
  menuBar: { width: 18, height: 1.5, backgroundColor: Intake.ink },

  main: { paddingTop: 76, paddingHorizontal: Intake.gutter, gap: 52, paddingBottom: 24 },

  brandGroup: { gap: 22 },
  wordmark: {
    fontFamily: Faces.headline,
    fontSize: 30,
    lineHeight: 44,
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: Intake.ink,
  },
  copyGroup: { gap: 16 },
  headline: {
    fontFamily: Faces.headline,
    fontSize: 42,
    lineHeight: 43, // 1.02
    letterSpacing: 0.21, // .005em
    textTransform: 'uppercase',
    color: Intake.ink,
  },
  body: {
    fontFamily: Faces.sans,
    fontSize: 14,
    lineHeight: 22, // 1.55
    color: Intake.body,
    maxWidth: 300,
  },

  inputGroup: { gap: 26 },

  error: { gap: 4 },
  errorTitle: { fontFamily: Faces.sansMedium, fontSize: 13, color: Intake.accent },

  recentsLabel: {
    fontFamily: Faces.sansMedium,
    fontSize: 10.5,
    letterSpacing: 1.68, // .16em
    textTransform: 'uppercase',
    color: Intake.mutedLabel,
    marginBottom: 14,
  },
  recentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 16,
    minHeight: TapTarget,
    borderTopWidth: 1,
    borderTopColor: Intake.ruleFooter,
  },
  recentPlate: {
    width: 64,
    fontFamily: Faces.plate,
    fontSize: 12.5,
    letterSpacing: 0.75, // .06em
    color: Intake.accent,
  },
  recentName: { flex: 1, fontFamily: Faces.sansMedium, fontSize: 14, color: Intake.ink },
  recentAge: { fontFamily: Faces.sans, fontSize: 12, color: Intake.mutedLabel },
  arrow: { fontSize: 15, color: Intake.accent },

  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginHorizontal: Intake.gutter,
    marginBottom: 28,
    paddingTop: 18,
    minHeight: 44,
    borderTopWidth: 1,
    borderTopColor: Intake.ruleFooter,
  },
  footerText: { fontFamily: Faces.sans, fontSize: 12.5, color: Intake.body },
  footerArrow: { fontSize: 15, color: Intake.accent },
});
