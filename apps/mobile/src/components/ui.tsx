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

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
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

const styles = StyleSheet.create({
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
