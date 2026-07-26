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
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import Animated, {
  interpolateColor,
  useAnimatedStyle,
  useDerivedValue,
  withTiming,
} from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';
import { Faces, Intake, NoFocusRing, TapTarget } from '@/constants/theme';
import { toErrorInfo, useAsyncData } from '@/hooks/use-async-data';
import type { ErrorInfo } from '@/hooks/use-case';
import { backend } from '@/lib/backend';
import { listRecentCases } from '@/lib/recent-cases';

/** The spec's 150ms ease, shared by the underline and the button. */
const ACCENT_MS = 150;

/** Chips are a shortcut, not a directory. */
const MAX_CHIPS = 3;

export interface RegoEntryProps {
  /** Fired as soon as the plate is accepted — before the VIN comes back. */
  onRegistered: (vehicleId: string, rego: string) => void;
  /** The header's menu button; the drawer itself lives on the parent screen. */
  onOpenMenu: () => void;
}

export function RegoEntry({ onRegistered, onOpenMenu }: RegoEntryProps) {
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
  const chips = useMemo(() => {
    const startable = (vehicles.data ?? []).filter((vehicle) => vehicle.has_catalogue);
    const recentPlates = listRecentCases()
      .map((entry) => entry.label.split('·').pop()?.trim().toUpperCase())
      .filter((plate): plate is string => Boolean(plate));
    const rank = (rego: string) => {
      const seen = recentPlates.indexOf(rego.toUpperCase());
      return seen === -1 ? Number.MAX_SAFE_INTEGER : seen;
    };
    return [...startable].sort((a, b) => rank(a.rego) - rank(b.rego)).slice(0, MAX_CHIPS);
  }, [vehicles.data]);

  const filled = draft.trim().length > 0;
  // One shared 0→1 drives the underline and the button together, so they never
  // disagree about whether the field has something in it.
  const accent = useDerivedValue(() => withTiming(filled ? 1 : 0, { duration: ACCENT_MS }));

  const underlineStyle = useAnimatedStyle(() => ({
    borderBottomColor: interpolateColor(
      accent.value,
      [0, 1],
      [Intake.ruleInput, Intake.accent],
    ),
  }));
  const buttonStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(
      accent.value,
      [0, 1],
      [Intake.buttonIdle, Intake.accent],
    ),
  }));
  const buttonTextStyle = useAnimatedStyle(() => ({
    color: interpolateColor(accent.value, [0, 1], [Intake.buttonIdleText, '#FFFFFF']),
  }));

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
      <View style={styles.header}>
        <ThemedText style={styles.eyebrow}>Vehicle intake</ThemedText>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open recent cases"
          onPress={onOpenMenu}
          hitSlop={12}
          style={({ pressed }) => [styles.menuButton, { opacity: pressed ? 0.5 : 1 }]}
        >
          <View style={styles.menuBar} />
          <View style={styles.menuBar} />
        </Pressable>
      </View>

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
            <ThemedText style={styles.headline}>Enter the rego to start.</ThemedText>
            <ThemedText style={styles.body}>
              One plate is enough. We&rsquo;ll bring up the vehicle and everything already
              known about it.
            </ThemedText>
          </View>
        </View>

        <View style={styles.inputGroup}>
          <Animated.View style={[styles.field, underlineStyle]}>
            <TextInput
              value={draft}
              onChangeText={setDraft}
              onSubmitEditing={() => void lookUp(draft)}
              placeholder="Rego number"
              placeholderTextColor={Intake.mutedLabel}
              autoCapitalize="characters"
              autoCorrect={false}
              returnKeyType="go"
              accessibilityLabel="Registration number"
              style={styles.input}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Continue"
              // Disabled is announced, not just greyed — the colour change is
              // the affordance for people who can see it, this is for everyone.
              accessibilityState={{ disabled: !filled || submitting }}
              disabled={!filled || submitting}
              onPress={() => void lookUp(draft)}
              style={({ pressed }) => [styles.continue, { opacity: pressed ? 0.8 : 1 }]}
            >
              <Animated.View style={[StyleSheet.absoluteFill, styles.continueFill, buttonStyle]} />
              <Animated.Text style={[styles.continueText, buttonTextStyle]}>
                {submitting ? 'Looking up…' : 'Continue'}
              </Animated.Text>
            </Pressable>
          </Animated.View>

          {error ? (
            <View style={styles.error}>
              <ThemedText style={styles.errorTitle}>{error.title}</ThemedText>
              {error.detail ? <ThemedText style={styles.body}>{error.detail}</ThemedText> : null}
            </View>
          ) : null}

          <View style={styles.recents}>
            <ThemedText style={styles.recentsLabel}>Pick up where you left off</ThemedText>
            <View style={styles.chipRow}>
              {chips.map((vehicle) => (
                <Pressable
                  key={vehicle.rego}
                  accessibilityRole="button"
                  accessibilityLabel={`Use ${vehicle.rego}, ${vehicle.make} ${vehicle.model}`}
                  // Fills the field; submitting stays a deliberate second tap.
                  onPress={() => setDraft(vehicle.rego)}
                  style={({ pressed }) => [
                    styles.chip,
                    { borderColor: pressed ? Intake.accent : Intake.ruleChip },
                  ]}
                >
                  <ThemedText style={styles.chipPlate}>{vehicle.rego}</ThemedText>
                  <ThemedText style={styles.chipVehicle}>
                    {vehicle.make} {vehicle.model}
                  </ThemedText>
                </Pressable>
              ))}
            </View>
          </View>
        </View>
      </ScrollView>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Which vehicles can I assess?"
        onPress={showAssessable}
        style={({ pressed }) => [styles.footer, { opacity: pressed ? 0.6 : 1 }]}
      >
        <ThemedText style={styles.footerText}>Which vehicles can I assess?</ThemedText>
        <ThemedText style={styles.footerArrow}>→</ThemedText>
      </Pressable>
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

  main: {
    flexGrow: 1,
    justifyContent: 'center',
    gap: 30,
    paddingHorizontal: Intake.gutter,
    paddingVertical: 24,
  },

  brandGroup: { gap: 20 },
  wordmark: {
    fontFamily: Faces.headline,
    fontSize: 34,
    lineHeight: 44,
    color: Intake.ink,
    letterSpacing: -0.5,
  },
  copyGroup: { gap: 16 },
  headline: {
    fontFamily: Faces.headline,
    fontSize: 40,
    lineHeight: 42, // 1.05
    letterSpacing: -0.6, // -.015em
    color: Intake.ink,
  },
  body: {
    fontFamily: Faces.sans,
    fontSize: 14,
    lineHeight: 22, // 1.55
    color: Intake.body,
    maxWidth: 290,
  },

  inputGroup: { gap: 22 },
  field: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 14,
    borderBottomWidth: 1.5,
  },
  input: {
    flex: 1,
    fontFamily: Faces.sansMedium,
    fontSize: 17,
    color: Intake.ink,
    paddingBottom: 12,
    ...NoFocusRing,
  },
  continue: {
    borderRadius: 999,
    paddingHorizontal: 20,
    paddingVertical: 11,
    marginBottom: 8,
    overflow: 'hidden',
    justifyContent: 'center',
  },
  continueFill: { borderRadius: 999 },
  continueText: { fontFamily: Faces.sansMedium, fontSize: 13 },

  error: { gap: 4 },
  errorTitle: { fontFamily: Faces.sansMedium, fontSize: 13, color: Intake.accent },

  recents: { gap: 12 },
  recentsLabel: {
    fontFamily: Faces.sansMedium,
    fontSize: 10.5,
    letterSpacing: 1.68, // .16em
    textTransform: 'uppercase',
    color: Intake.mutedLabel,
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 13,
    paddingVertical: 9,
    // The spec's 9px padding is under the 44pt touch minimum on its own.
    minHeight: 40,
  },
  chipPlate: {
    fontFamily: Faces.plate,
    fontSize: 12,
    letterSpacing: 0.72, // .06em
    color: Intake.accent,
  },
  chipVehicle: { fontFamily: Faces.sans, fontSize: 12.5, color: Intake.chipVehicle },

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
