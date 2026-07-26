/**
 * The three pieces the assessment report is made of.
 *
 * `PartCard` carries the rule the whole product turns on: a predicted part
 * always shows *why* it was flagged. The reasoning meta is the attribution the
 * engine already computes — each cause's share of the arithmetic — so a
 * repairer reads "48% impact zone · 24% base rate" and can check it rather than
 * taking a percentage on trust. A confirmed part shows no number at all: it is
 * a fact now, not a prediction, and a percentage beside it would be hedging.
 */

import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Faces, Intake, Round, TapTarget } from '@/constants/theme';

// --- Segmented tabs ---------------------------------------------------------

export interface SegmentedTab<T extends string> {
  key: T;
  label: string;
  count: number;
}

export function SegmentedTabs<T extends string>({
  tabs,
  active,
  onSelect,
}: {
  tabs: SegmentedTab<T>[];
  active: T;
  onSelect: (key: T) => void;
}) {
  return (
    <View style={styles.tabs}>
      {tabs.map((tab) => {
        const selected = tab.key === active;
        return (
          <Pressable
            key={tab.key}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            accessibilityLabel={`${tab.label}, ${tab.count} parts`}
            onPress={() => onSelect(tab.key)}
            style={({ pressed }) => [
              styles.tab,
              selected
                ? { backgroundColor: Intake.accent, borderColor: Intake.accent }
                : { backgroundColor: Intake.accentPale, borderColor: Intake.accentPaleBorder },
              { transform: [{ scale: pressed ? 0.98 : 1 }] },
            ]}
          >
            <ThemedText
              style={[
                styles.tabLabel,
                { color: selected ? '#FFFFFF' : Intake.accentPaleText },
              ]}
            >
              {tab.label}
            </ThemedText>
            <View
              style={[
                styles.tabCount,
                { backgroundColor: selected ? 'rgba(255,255,255,0.24)' : '#FFFFFF' },
              ]}
            >
              <ThemedText
                style={[
                  styles.tabCountText,
                  { color: selected ? '#FFFFFF' : Intake.accentPaleText },
                ]}
              >
                {tab.count}
              </ThemedText>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

// --- Part card --------------------------------------------------------------

export interface PartCardProps {
  name: string;
  /** 0..1. Only shown when the part is still a prediction. */
  p?: number;
  /** Why the model flagged it — required on every predicted part. */
  reasoning?: string;
  confirmed?: boolean;
  onConfirm?: () => void;
  busy?: boolean;
  /** Tints the card when the last answer moved this row. */
  moved?: boolean;
}

export function PartCard({
  name,
  p,
  reasoning,
  confirmed,
  onConfirm,
  busy,
  moved,
}: PartCardProps) {
  return (
    <View
      style={[
        styles.card,
        moved ? { backgroundColor: Intake.accentPale, borderColor: Intake.accentPaleBorder } : null,
      ]}
    >
      {confirmed ? null : (
        <View style={styles.confidence}>
          <ThemedText style={styles.confidenceValue}>{Math.round((p ?? 0) * 100)}</ThemedText>
          <ThemedText style={styles.confidenceSign}>%</ThemedText>
        </View>
      )}

      <View style={styles.cardBody}>
        <ThemedText style={styles.cardName} numberOfLines={2}>
          {name}
        </ThemedText>

        {confirmed ? (
          <>
            <ThemedText style={styles.cardMeta}>Confirmed at the car</ThemedText>
            <ThemedText style={styles.verified}>✓ verified</ThemedText>
          </>
        ) : (
          <>
            {reasoning ? (
              <ThemedText style={styles.cardMeta} numberOfLines={2}>
                {reasoning}
              </ThemedText>
            ) : null}
            {onConfirm ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Confirm ${name} is damaged`}
                accessibilityState={{ disabled: busy }}
                disabled={busy}
                onPress={onConfirm}
                hitSlop={10}
                style={({ pressed }) => [
                  styles.confirmLink,
                  { opacity: pressed || busy ? 0.6 : 1 },
                ]}
              >
                <ThemedText style={styles.confirmText}>Confirm →</ThemedText>
              </Pressable>
            ) : null}
          </>
        )}
      </View>
    </View>
  );
}

// --- Question card ----------------------------------------------------------

export function QuestionCard({
  question,
  options,
  onAnswer,
  answering,
}: {
  question: string;
  options: string[];
  onAnswer: (option: string) => void;
  answering?: string | null;
}) {
  return (
    <View style={styles.question}>
      <ThemedText style={styles.questionLabel}>One question</ThemedText>
      <ThemedText style={styles.questionText}>{question}</ThemedText>
      <View style={styles.answerRow}>
        {options.map((option) => (
          <Pressable
            key={option}
            accessibilityRole="button"
            accessibilityLabel={option}
            accessibilityState={{ disabled: answering != null }}
            disabled={answering != null}
            onPress={() => onAnswer(option)}
            style={({ pressed }) => [
              styles.answerChip,
              {
                backgroundColor: answering === option ? Intake.accentPale : '#FFFFFF',
                opacity: pressed ? 0.7 : 1,
              },
            ]}
          >
            <ThemedText style={styles.answerText}>{option}</ThemedText>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  tabs: { flexDirection: 'row', gap: 8 },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    minHeight: TapTarget - 4,
    paddingVertical: 13,
    borderWidth: 1,
    borderRadius: Round.tab,
  },
  tabLabel: { fontFamily: Faces.sansSemi, fontSize: 13 },
  tabCount: { borderRadius: 5, paddingHorizontal: 6, paddingVertical: 3 },
  tabCountText: { fontFamily: Faces.sansSemi, fontSize: 11 },

  card: {
    flexDirection: 'row',
    gap: 12,
    backgroundColor: Intake.surface,
    borderWidth: 1,
    borderColor: Intake.ruleFooter,
    borderRadius: Round.card,
    paddingVertical: 14,
    paddingHorizontal: 15,
  },
  // A fixed column, so names start on the same x whatever the number is.
  confidence: { width: 56, flexDirection: 'row', alignItems: 'flex-start' },
  confidenceValue: {
    fontFamily: Faces.headlineLight,
    fontSize: 30,
    lineHeight: 32,
    color: Intake.ink,
  },
  confidenceSign: {
    fontFamily: Faces.sans,
    fontSize: 12,
    lineHeight: 18,
    marginTop: 3,
    color: Intake.mutedLabel,
  },
  cardBody: { flex: 1, gap: 4 },
  cardName: { fontFamily: Faces.sansMedium, fontSize: 14, lineHeight: 17.5, color: Intake.ink },
  cardMeta: { fontFamily: Faces.sans, fontSize: 11.5, color: Intake.mutedLabel },
  verified: { fontFamily: Faces.sans, fontSize: 12, color: Intake.secondary },
  confirmLink: { minHeight: 28, justifyContent: 'center' },
  confirmText: { fontFamily: Faces.sansMedium, fontSize: 12.5, color: Intake.accent },

  question: {
    borderLeftWidth: 2.5,
    borderLeftColor: Intake.accent,
    backgroundColor: Intake.surface,
    borderTopRightRadius: Round.card,
    borderBottomRightRadius: Round.card,
    paddingVertical: 14,
    paddingHorizontal: 15,
    gap: 11,
  },
  questionLabel: {
    fontFamily: Faces.sansMedium,
    fontSize: 10,
    letterSpacing: 1.6,
    textTransform: 'uppercase',
    color: Intake.mutedLabel,
  },
  questionText: {
    fontFamily: Faces.sansMedium,
    fontSize: 14.5,
    lineHeight: 20.3, // 1.4
    color: Intake.ink,
  },
  answerRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  answerChip: {
    borderWidth: 1,
    borderColor: Intake.answerChipBorder,
    borderRadius: Round.answerChip,
    paddingVertical: 11,
    paddingHorizontal: 15,
    minHeight: 44,
    justifyContent: 'center',
  },
  answerText: { fontFamily: Faces.sansMedium, fontSize: 13, color: Intake.accentPaleText },
});
