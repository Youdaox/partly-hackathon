/**
 * Small shared UI primitives for the repairer app.
 *
 * Deliberately plain React Native — no styling library — so anyone on the team can
 * change them without learning a new API mid-hackathon.
 */

import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  View,
  type PressableProps,
  type ViewProps,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing, TapTarget } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

// --- Button -----------------------------------------------------------------

type ButtonVariant = 'primary' | 'secondary' | 'success' | 'danger';

export interface ButtonProps extends Omit<PressableProps, 'children' | 'style'> {
  title: string;
  variant?: ButtonVariant;
  loading?: boolean;
  fullWidth?: boolean;
}

export function Button({
  title,
  variant = 'primary',
  loading = false,
  fullWidth = false,
  disabled,
  ...rest
}: ButtonProps) {
  const theme = useTheme();
  const isDisabled = disabled || loading;

  const background =
    variant === 'primary'
      ? theme.accent
      : variant === 'success'
        ? theme.success
        : variant === 'danger'
          ? theme.danger
          : theme.backgroundElement;

  const textColor = variant === 'secondary' ? theme.text : theme.accentText;

  return (
    <Pressable
      accessibilityRole="button"
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: background, opacity: isDisabled ? 0.5 : pressed ? 0.8 : 1 },
        fullWidth && styles.fullWidth,
      ]}
      {...rest}
    >
      {loading ? (
        <ActivityIndicator color={textColor} />
      ) : (
        <ThemedText style={[styles.buttonText, { color: textColor }]}>{title}</ThemedText>
      )}
    </Pressable>
  );
}

// --- Card -------------------------------------------------------------------

export function Card({ style, ...rest }: ViewProps) {
  const theme = useTheme();
  return (
    <View
      style={[
        styles.card,
        { backgroundColor: theme.backgroundElement, borderColor: theme.border },
        style,
      ]}
      {...rest}
    />
  );
}

// --- Confidence bar ---------------------------------------------------------

/** Horizontal 0..1 meter. Colour tracks how strong the prediction is. */
export function ConfidenceBar({ value }: { value: number }) {
  const theme = useTheme();
  const clamped = Math.max(0, Math.min(1, value));
  const color = clamped >= 0.75 ? theme.danger : clamped >= 0.5 ? theme.warning : theme.accent;

  return (
    <View style={styles.confidenceRow}>
      <View
        style={[styles.confidenceTrack, { backgroundColor: theme.backgroundSelected }]}
        accessibilityRole="progressbar"
        accessibilityValue={{ now: Math.round(clamped * 100), min: 0, max: 100 }}
      >
        <View
          style={[styles.confidenceFill, { width: `${clamped * 100}%`, backgroundColor: color }]}
        />
      </View>
      <ThemedText type="smallBold" style={[styles.confidenceLabel, { color }]}>
        {Math.round(clamped * 100)}%
      </ThemedText>
    </View>
  );
}

// --- Likelihood -------------------------------------------------------------

/**
 * The one confidence treatment, and it belongs only to predictions.
 *
 * A repairer does not act differently on 0.78 than on 0.81, so the raw
 * percentage was precision nobody used and noise everybody read. Three bands
 * are what the decision actually has: order it, probably order it, look first.
 *
 * Never rendered next to observed damage — a part Partly saw in the photo is a
 * fact, and a number beside it reads as hedging.
 */
export function LikelihoodChip({ value }: { value: number }) {
  const theme = useTheme();
  const { label, color } =
    value >= 0.8
      ? { label: 'High', color: theme.danger }
      : value >= 0.6
        ? { label: 'Medium', color: theme.warning }
        : { label: 'Low', color: theme.textSecondary };

  return (
    <View style={[styles.likelihoodChip, { borderColor: color }]}>
      <ThemedText type="small" style={{ color }}>
        {label}
      </ThemedText>
    </View>
  );
}

// --- Status pill ------------------------------------------------------------

export function Pill({ label, tone = 'neutral' }: { label: string; tone?: 'neutral' | 'accent' | 'success' }) {
  const theme = useTheme();
  const background =
    tone === 'accent' ? theme.accent : tone === 'success' ? theme.success : theme.backgroundSelected;
  const color = tone === 'neutral' ? theme.textSecondary : theme.accentText;

  return (
    <View style={[styles.pill, { backgroundColor: background }]}>
      <ThemedText type="small" style={{ color }}>
        {label}
      </ThemedText>
    </View>
  );
}

// --- Feedback states --------------------------------------------------------

export function ErrorNotice({ title, detail }: { title: string; detail?: string }) {
  const theme = useTheme();
  return (
    <Card style={{ borderColor: theme.danger }}>
      <ThemedText type="smallBold" style={{ color: theme.danger }}>
        {title}
      </ThemedText>
      {detail ? (
        <ThemedText type="small" themeColor="textSecondary" style={styles.errorDetail}>
          {detail}
        </ThemedText>
      ) : null}
    </Card>
  );
}

export function EmptyState({ message }: { message: string }) {
  return (
    <View style={styles.empty}>
      <ThemedText type="small" themeColor="textSecondary" style={styles.emptyText}>
        {message}
      </ThemedText>
    </View>
  );
}

export function Loading({ label }: { label?: string }) {
  const theme = useTheme();
  return (
    <View style={styles.empty}>
      <ActivityIndicator color={theme.accent} />
      {label ? (
        <ThemedText type="small" themeColor="textSecondary" style={styles.emptyText}>
          {label}
        </ThemedText>
      ) : null}
    </View>
  );
}

// --- Match badge ------------------------------------------------------------

/**
 * The `95% match` badge from the report mockup.
 *
 * Three tiers, because a flat badge makes 95% and 38% look equally worth acting on:
 * strong is filled, worth-a-look is outlined, weak is quiet grey.
 */
export function MatchBadge({ value }: { value: number }) {
  const theme = useTheme();
  const percent = Math.round(Math.max(0, Math.min(1, value)) * 100);
  const tier = percent >= 75 ? 'strong' : percent >= 50 ? 'medium' : 'weak';

  const style =
    tier === 'strong'
      ? { backgroundColor: theme.badgeFill, borderColor: 'transparent' }
      : tier === 'medium'
        ? { backgroundColor: 'transparent', borderColor: theme.accent }
        : { backgroundColor: theme.backgroundSelected, borderColor: 'transparent' };

  const color = tier === 'weak' ? theme.textSecondary : theme.badgeText;

  return (
    <View style={[styles.matchBadge, style]}>
      <ThemedText type="small" style={[styles.matchBadgeText, { color }]}>
        {percent}% match
      </ThemedText>
    </View>
  );
}

// --- Numbered badge ---------------------------------------------------------

/** The filled circle that ties a report row to its marker on the vehicle diagram. */
export function NumberBadge({ n, muted = false }: { n: number; muted?: boolean }) {
  const theme = useTheme();
  return (
    <View style={[styles.numberBadge, { backgroundColor: muted ? theme.textSecondary : theme.badgeText }]}>
      <ThemedText type="small" style={[styles.numberBadgeText, { color: theme.accentText }]}>
        {n}
      </ThemedText>
    </View>
  );
}

// --- Section label ----------------------------------------------------------

/** Letterspaced small caps, e.g. `AFFECTED ZONES`. */
export function SectionLabel({ children }: { children: string }) {
  const theme = useTheme();
  return (
    <ThemedText type="label" style={{ color: theme.iconMuted }}>
      {children}
    </ThemedText>
  );
}

// --- Suggestion row ---------------------------------------------------------

/** One of the tappable prompts under the entry box: an outline icon and a label. */
export function SuggestionRow({
  icon,
  label,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress?: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [styles.suggestionRow, { opacity: pressed ? 0.55 : 1 }]}
    >
      <Ionicons name={icon} size={21} color={theme.iconMuted} />
      <ThemedText style={{ color: theme.textSecondary }}>{label}</ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  matchBadge: {
    paddingHorizontal: Spacing.three - 4,
    paddingVertical: Spacing.one + 2,
    borderRadius: Radius.chip,
    borderWidth: 1,
  },
  matchBadgeText: {
    fontWeight: '700',
    fontSize: 13,
  },
  numberBadge: {
    width: 26,
    height: 26,
    borderRadius: Radius.round,
    alignItems: 'center',
    justifyContent: 'center',
  },
  numberBadgeText: {
    fontSize: 13,
    fontWeight: '700',
    lineHeight: 18,
  },
  suggestionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    minHeight: TapTarget,
    paddingHorizontal: Spacing.one,
  },
  button: {
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.four,
    borderRadius: Spacing.three,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 52,
  },
  fullWidth: {
    alignSelf: 'stretch',
  },
  buttonText: {
    fontWeight: '700',
  },
  card: {
    borderRadius: Spacing.three,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  confidenceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  confidenceTrack: {
    flex: 1,
    height: 8,
    borderRadius: 4,
    overflow: 'hidden',
  },
  confidenceFill: {
    height: '100%',
    borderRadius: 4,
  },
  confidenceLabel: {
    minWidth: 44,
    textAlign: 'right',
  },
  pill: {
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.half,
    borderRadius: Spacing.four,
    alignSelf: 'flex-start',
  },
  likelihoodChip: {
    paddingHorizontal: Spacing.one,
    paddingVertical: 1,
    borderRadius: Spacing.four,
    borderWidth: StyleSheet.hairlineWidth,
    alignSelf: 'flex-start',
  },
  errorDetail: {
    marginTop: Spacing.one,
  },
  empty: {
    paddingVertical: Spacing.five,
    alignItems: 'center',
    gap: Spacing.two,
  },
  emptyText: {
    textAlign: 'center',
  },
});
