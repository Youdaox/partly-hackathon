/**
 * The small shared pieces every Partli screen is built from.
 *
 * The point of collecting them here is that a screen should not be able to
 * invent its own header, its own row, or its own idea of what a title looks
 * like. If something on screen needs a treatment that is not in this file, the
 * answer is usually a new prop here rather than a style in the screen.
 *
 * Everything sizes its own touch target: the visual marks are 20-30px to match
 * the design, and `hitSlop` carries each one to the 44pt minimum. The audience
 * is wearing gloves.
 */

import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type TextStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { ThemedText } from '@/components/themed-text';
import { Faces, Intake, Round, TapTarget } from '@/constants/theme';

// --- Header -----------------------------------------------------------------

export interface ScreenHeaderProps {
  onBack?: () => void;
  backLabel?: string;
  /** Rendered between the chevron and the action — usually a <VehicleLine>. */
  children?: ReactNode;
  onAction?: () => void;
  actionLabel?: string;
  actionIcon?: keyof typeof Ionicons.glyphMap;
}

export function ScreenHeader({
  onBack,
  backLabel = 'Back',
  children,
  onAction,
  actionLabel,
  actionIcon = 'add',
}: ScreenHeaderProps) {
  return (
    <View style={styles.header}>
      {onBack ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={backLabel}
          onPress={onBack}
          hitSlop={12}
          style={({ pressed }) => [styles.headerTap, { opacity: pressed ? 0.5 : 1 }]}
        >
          <Ionicons name="chevron-back" size={20} color={Intake.accent} />
        </Pressable>
      ) : (
        <View style={styles.headerTap} />
      )}

      <View style={styles.headerBody}>{children}</View>

      {onAction ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={actionLabel ?? 'Action'}
          onPress={onAction}
          hitSlop={12}
          style={({ pressed }) => [
            styles.headerTap,
            styles.headerTapEnd,
            { opacity: pressed ? 0.5 : 1 },
          ]}
        >
          <Ionicons name={actionIcon} size={20} color={Intake.accent} />
        </Pressable>
      ) : (
        <View style={styles.headerTap} />
      )}
    </View>
  );
}

// --- Vehicle line -----------------------------------------------------------

export interface VehicleLineProps {
  name: string;
  plate?: string | null;
  /** e.g. "7,009 parts" — omitted while the catalogue is still loading. */
  meta?: string | null;
  /** Shows the green tick, for when the catalogue has landed. */
  confirmed?: boolean;
}

export function VehicleLine({ name, plate, meta, confirmed }: VehicleLineProps) {
  return (
    <View style={styles.vehicleLine}>
      {confirmed ? (
        <View style={styles.successDot}>
          <Ionicons name="checkmark" size={10} color="#FFFFFF" />
        </View>
      ) : null}
      {name ? <ThemedText style={styles.vehicleName}>{name}</ThemedText> : null}
      {plate ? <ThemedText style={styles.plate}>{plate}</ThemedText> : null}
      {meta ? <ThemedText style={styles.vehicleMeta}>{meta}</ThemedText> : null}
    </View>
  );
}

// --- Titles and labels ------------------------------------------------------

/** Oswald, uppercased by transform so the copy stays sentence-case. */
export function PageTitle({
  children,
  size = 40,
  style,
}: {
  children: string;
  size?: number;
  style?: StyleProp<TextStyle>;
}) {
  return (
    <ThemedText
      accessibilityRole="header"
      style={[styles.pageTitle, { fontSize: size, lineHeight: size * 1.02 }, style]}
    >
      {children}
    </ThemedText>
  );
}

/** The letterspaced small-caps that introduce a region. */
export function SectionLabel({ children }: { children: string }) {
  return <ThemedText style={styles.sectionLabel}>{children}</ThemedText>;
}

export function Rule() {
  return <View style={styles.rule} />;
}

// --- Buttons ----------------------------------------------------------------

export function PrimaryButton({
  title,
  onPress,
  disabled,
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor: disabled
            ? Intake.buttonIdle
            : pressed
              ? Intake.accentHover
              : Intake.accent,
        },
      ]}
    >
      <ThemedText
        style={[styles.buttonText, { color: disabled ? Intake.buttonIdleText : '#FFFFFF' }]}
      >
        {title}
      </ThemedText>
    </Pressable>
  );
}

export function SecondaryButton({
  title,
  onPress,
  disabled,
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        styles.secondary,
        { borderColor: pressed ? Intake.accent : Intake.ruleChip, opacity: disabled ? 0.5 : 1 },
      ]}
    >
      <ThemedText
        style={[styles.buttonText, { color: disabled ? Intake.buttonIdleText : Intake.ink }]}
      >
        {title}
      </ThemedText>
    </Pressable>
  );
}

// --- List row ---------------------------------------------------------------

export interface ListRowProps {
  /** Leading mark: an icon chip, a plate, whatever the row is keyed by. */
  leading?: ReactNode;
  title: string;
  meta?: string;
  /** Right-aligned before the arrow — an age, a count. */
  trailing?: string;
  onPress: () => void;
  accessibilityLabel?: string;
}

export function ListRow({
  leading,
  title,
  meta,
  trailing,
  onPress,
  accessibilityLabel,
}: ListRowProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? (meta ? `${title}. ${meta}` : title)}
      onPress={onPress}
      style={({ pressed }) => [styles.listRow, { opacity: pressed ? 0.6 : 1 }]}
    >
      {leading}
      <View style={styles.listCopy}>
        <ThemedText style={styles.listTitle}>{title}</ThemedText>
        {meta ? <ThemedText style={styles.listMeta}>{meta}</ThemedText> : null}
      </View>
      {trailing ? <ThemedText style={styles.listTrailing}>{trailing}</ThemedText> : null}
      <ThemedText style={styles.arrow}>→</ThemedText>
    </Pressable>
  );
}

/** The bordered square/round/dashed mark that leads an evidence row. */
export function IconChip({
  icon,
  shape = 'square',
}: {
  icon: keyof typeof Ionicons.glyphMap;
  shape?: 'square' | 'round' | 'dashed';
}) {
  return (
    <View
      style={[
        styles.iconChip,
        shape === 'round' && { borderRadius: Round.pill },
        shape === 'dashed' && { borderStyle: 'dashed' },
      ]}
    >
      <Ionicons name={icon} size={12} color={Intake.mutedLabel} />
    </View>
  );
}

// --- Footer -----------------------------------------------------------------

/**
 * The ruled bar that closes a screen: a quiet label and an accent action.
 *
 * The label is optional. Where the action already names what it does, a label beside it is
 * just a second title for the same thing — so the action right-aligns on its own instead.
 */
export function FooterBar({
  label,
  action,
  onPress,
}: {
  label?: string;
  action: string;
  onPress: () => void;
}) {
  return (
    <View style={[styles.footer, label ? null : styles.footerActionOnly]}>
      {label ? <ThemedText style={styles.footerLabel}>{label}</ThemedText> : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={action}
        onPress={onPress}
        hitSlop={12}
        style={({ pressed }) => [styles.footerAction, { opacity: pressed ? 0.6 : 1 }]}
      >
        <ThemedText style={styles.footerActionText}>{action}</ThemedText>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingTop: 20,
    paddingHorizontal: Intake.gutter,
  },
  headerTap: { width: TapTarget - 12, height: TapTarget - 12, justifyContent: 'center' },
  headerTapEnd: { alignItems: 'flex-end' },
  headerBody: { flex: 1 },

  vehicleLine: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  successDot: {
    width: 15,
    height: 15,
    borderRadius: Round.pill,
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

  pageTitle: {
    fontFamily: Faces.headline,
    letterSpacing: 0.2, // .005em
    textTransform: 'uppercase',
    color: Intake.ink,
  },
  sectionLabel: {
    fontFamily: Faces.sansMedium,
    fontSize: 10.5,
    letterSpacing: 1.68, // .16em
    textTransform: 'uppercase',
    color: Intake.mutedLabel,
  },
  rule: { height: 1, backgroundColor: Intake.ruleFooter },

  button: {
    height: 52,
    borderRadius: Round.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondary: { backgroundColor: Intake.surface, borderWidth: 1 },
  buttonText: { fontFamily: Faces.sansMedium, fontSize: 14.5 },

  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 18,
    minHeight: TapTarget,
    borderTopWidth: 1,
    borderTopColor: Intake.ruleFooter,
  },
  listCopy: { flex: 1, gap: 3 },
  listTitle: { fontFamily: Faces.sansMedium, fontSize: 13.5, color: Intake.ink },
  listMeta: { fontFamily: Faces.sans, fontSize: 11.5, color: Intake.mutedLabel },
  listTrailing: { fontFamily: Faces.sans, fontSize: 12, color: Intake.mutedLabel },
  arrow: { fontSize: 15, color: Intake.accent },

  iconChip: {
    width: 26,
    height: 26,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: Intake.ruleChip,
    backgroundColor: Intake.chipFill,
    alignItems: 'center',
    justifyContent: 'center',
  },

  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 12,
    marginHorizontal: Intake.gutter,
    marginBottom: 22,
    paddingTop: 14,
    minHeight: 44,
    borderTopWidth: 1,
    borderTopColor: Intake.ruleFooter,
  },
  // With nothing on the left, `space-between` would strand the action there.
  footerActionOnly: { justifyContent: 'flex-end' },
  footerLabel: { fontFamily: Faces.sansMedium, fontSize: 13, color: Intake.body },
  footerAction: { minHeight: 44, justifyContent: 'center' },
  footerActionText: { fontFamily: Faces.sansMedium, fontSize: 13, color: Intake.accent },
});
