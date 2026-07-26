/**
 * The one input both intake screens use.
 *
 * A surface rather than a line: the rego screen and the damage screen ask for
 * different things but ask the same *way*, and a shared component is what keeps
 * them from drifting apart the next time either is touched. Two rows — what you
 * type, then what you can do about it — so the attach and dictate affordances
 * sit under the text instead of crowding it.
 *
 * The whole surface takes the accent on the first character: border, ring and
 * send together, off one shared value, so they cannot disagree about whether
 * there is anything to send.
 */

import { useCallback } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import Animated, {
  interpolateColor,
  useAnimatedStyle,
  useDerivedValue,
  withTiming,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';

import { ThemedText } from '@/components/themed-text';
import { Faces, Intake, NoFocusRing } from '@/constants/theme';

/** Shared with the rest of the intake system. */
const ACCENT_MS = 150;

export interface IntakeComposerProps {
  value: string;
  onChangeText: (text: string) => void;
  onSubmit: () => void;
  placeholder: string;
  /** Sits beside the "+", and gives way once the user starts typing. */
  hint: string;
  /**
   * The "+". Omitted when the screen has nothing to attach — a button that
   * does nothing is worse than one that is not there.
   */
  onAttach?: () => void;
  attachLabel?: string;
  /** Send is available for reasons other than text — an attached photo counts. */
  canSend?: boolean;
  onDictate?: () => void;
  dictateActive?: boolean;
  dictateDisabled?: boolean;
  /** Announced on the send button, e.g. "Continue" or "Analyse". */
  submitLabel: string;
}

export function IntakeComposer({
  value,
  onChangeText,
  onSubmit,
  placeholder,
  hint,
  onAttach,
  attachLabel,
  canSend,
  onDictate,
  dictateActive = false,
  dictateDisabled = false,
  submitLabel,
}: IntakeComposerProps) {
  const typed = value.trim().length > 0;
  const armed = canSend ?? typed;

  const accent = useDerivedValue(() => withTiming(armed ? 1 : 0, { duration: ACCENT_MS }));

  const surfaceStyle = useAnimatedStyle(() => ({
    borderColor: interpolateColor(accent.value, [0, 1], [Intake.ruleChip, Intake.accent]),
    // React Native has no box-shadow spread, so the focus ring is drawn as a
    // shadow that grows with the same value the border animates on.
    shadowOpacity: 0.03 + accent.value * 0.07,
    shadowRadius: 1 + accent.value * 4,
  }));
  const sendFill = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(
      accent.value,
      [0, 1],
      [Intake.buttonIdle, Intake.accent],
    ),
  }));

  const submit = useCallback(() => {
    if (!armed) return;
    onSubmit();
  }, [armed, onSubmit]);

  return (
    <Animated.View style={[styles.surface, surfaceStyle]}>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        onSubmitEditing={submit}
        placeholder={placeholder}
        placeholderTextColor={Intake.body}
        accessibilityLabel={placeholder}
        returnKeyType="go"
        style={styles.input}
      />

      <View style={styles.controls}>
        {onAttach ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={attachLabel ?? 'Attach'}
            onPress={onAttach}
            hitSlop={10}
            style={({ pressed }) => [
              styles.round,
              { borderColor: pressed ? Intake.accent : Intake.ruleChip },
            ]}
          >
            <Ionicons name="add" size={16} color={Intake.body} />
          </Pressable>
        ) : null}

        {/* The hint explains the "+" — once there is text it has been read or
            it never will be, and the row is better without it. */}
        {typed ? null : <ThemedText style={styles.hint}>{hint}</ThemedText>}

        <View style={styles.spacer} />

        {onDictate ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={dictateActive ? 'Stop dictating' : 'Dictate'}
            accessibilityState={{ disabled: dictateDisabled, selected: dictateActive }}
            disabled={dictateDisabled}
            onPress={onDictate}
            hitSlop={10}
            style={({ pressed }) => [
              styles.round,
              {
                borderColor: dictateActive || pressed ? Intake.accent : Intake.ruleChip,
                opacity: dictateDisabled ? 0.4 : 1,
              },
            ]}
          >
            <Ionicons
              name={dictateActive ? 'stop' : 'mic'}
              size={15}
              color={dictateActive ? Intake.accent : Intake.mutedLabel}
            />
          </Pressable>
        ) : null}

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={submitLabel}
          // Announced as well as greyed: the colour is for people who can see
          // it, this is for everyone else.
          accessibilityState={{ disabled: !armed }}
          disabled={!armed}
          onPress={submit}
          hitSlop={10}
          style={({ pressed }) => [styles.send, { opacity: pressed ? 0.8 : 1 }]}
        >
          <Animated.View style={[StyleSheet.absoluteFill, styles.sendFill, sendFill]} />
          <Ionicons
            name="arrow-up"
            size={16}
            color={armed ? '#FFFFFF' : Intake.buttonIdleText}
          />
        </Pressable>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  surface: {
    backgroundColor: Intake.composer,
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingTop: 14,
    paddingBottom: 12,
    gap: 14,
    // The spec's 0 1px 2px rgba(20,18,10,.03); opacity and radius animate.
    shadowColor: '#141812',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.03,
    shadowRadius: 1,
    elevation: 1,
  },
  input: {
    fontFamily: Faces.sans,
    fontSize: 15.5,
    lineHeight: 22, // 1.45
    color: Intake.ink,
    padding: 0,
    ...NoFocusRing,
  },
  controls: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  // 30px circles; `hitSlop` carries each to the 44pt touch minimum.
  round: {
    width: 30,
    height: 30,
    borderRadius: 999,
    borderWidth: 1,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  hint: { fontFamily: Faces.sans, fontSize: 11.5, color: Intake.mutedLabel },
  spacer: { flex: 1 },
  send: {
    width: 30,
    height: 30,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  sendFill: { borderRadius: 999 },
});
