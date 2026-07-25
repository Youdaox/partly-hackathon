/**
 * The prompt composer, modelled on the ChatGPT mobile input.
 *
 * Behaviour worth being precise about, because it is what makes it feel right:
 *
 *  - it starts as a single-line pill and *grows* as the text wraps, rather than scrolling
 *    inside a fixed box;
 *  - growth is animated, so the morph is continuous rather than a jump;
 *  - past `maxLines` it stops growing and the text scrolls inside instead, so the composer
 *    can never eat the screen;
 *  - the send button is inert until there is something to send, then fills with the accent.
 *
 * Height is driven off the TextInput's own reported content size, which is the only thing
 * that knows how many lines the text actually wrapped to.
 */

import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';

import { NoFocusRing, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/** Reanimated cannot drive a plain TextInput's style; it has to be wrapped once. */
const AnimatedTextInput = Animated.createAnimatedComponent(TextInput);

/**
 * One line of the input at fontSize 16.
 *
 * The animated height is applied to the TextInput itself, not to a wrapper. React Native's
 * `height` is border-box, so a padded wrapper animated to the raw content height leaves
 * `height - padding` for the text and clips it — which is exactly what happened the first
 * time. All the padding lives on the shell instead.
 */
const LINE = 22;

export interface ComposerProps {
  value: string;
  onChangeText: (text: string) => void;
  onSubmit: () => void;
  placeholder?: string;
  /** Shows a spinner on the send button and blocks submission. */
  busy?: boolean;
  /** Left `+` affordance. Omitted when not given. */
  onPlusPress?: () => void;
  onMicPress?: () => void;
  micActive?: boolean;
  micDisabled?: boolean;
  autoFocus?: boolean;
  /** How tall it may grow before the text starts scrolling instead. */
  maxLines?: number;
}

export function Composer({
  value,
  onChangeText,
  onSubmit,
  placeholder = 'Describe the vehicle and damage',
  busy = false,
  onPlusPress,
  onMicPress,
  micActive = false,
  micDisabled = false,
  autoFocus = false,
  maxLines = 6,
}: ComposerProps) {
  const theme = useTheme();

  const minHeight = LINE;
  const maxHeight = LINE * maxLines;

  const [contentHeight, setContentHeight] = useState(minHeight);
  const height = useSharedValue(minHeight);

  useEffect(() => {
    const next = Math.min(Math.max(contentHeight, minHeight), maxHeight);
    height.value = withTiming(next, { duration: 120 });
  }, [contentHeight, minHeight, maxHeight, height]);

  const inputStyle = useAnimatedStyle(() => ({ height: height.value }));

  const hasText = value.trim().length > 0;

  // Once the text exceeds the cap, let the input scroll rather than grow.
  const scrollable = contentHeight > maxHeight;

  /**
   * On one line everything is centred with the send button; once the text wraps the buttons
   * settle to the bottom and the box grows upward, which is what the reference does.
   */
  const grown = contentHeight > LINE * 1.5;

  const handleContentSize = useCallback(
    (event: { nativeEvent: { contentSize: { height: number } } }) => {
      setContentHeight(event.nativeEvent.contentSize.height);
    },
    [],
  );

  const submit = useCallback(() => {
    if (!hasText || busy) return;
    onSubmit();
    // Collapse straight back to a pill; the text is gone, so the reported content size
    // will not fire again on its own.
    setContentHeight(minHeight);
  }, [hasText, busy, onSubmit, minHeight]);

  return (
    <View
      style={[
        styles.shell,
        {
          backgroundColor: theme.backgroundElement,
          borderColor: theme.border,
          alignItems: grown ? 'flex-end' : 'center',
        },
      ]}
    >
      {onPlusPress ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Add a photo or file"
          onPress={onPlusPress}
          hitSlop={8}
          style={({ pressed }) => [styles.iconButton, { opacity: pressed ? 0.5 : 1 }]}
        >
          <Ionicons name="add" size={24} color={theme.iconMuted} />
        </Pressable>
      ) : null}

      <AnimatedTextInput
        value={value}
        onChangeText={onChangeText}
        onContentSizeChange={handleContentSize}
        placeholder={placeholder}
        placeholderTextColor={theme.textSecondary}
        multiline
        scrollEnabled={scrollable}
        autoFocus={autoFocus}
        // `submitBehavior` keeps Return sending instead of inserting a newline, which is
        // what the reference does on a single-purpose composer.
        submitBehavior="submit"
        onSubmitEditing={submit}
        returnKeyType="go"
        style={[styles.input, { color: theme.text }, NoFocusRing, inputStyle]}
      />

      {onMicPress ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={micActive ? 'Stop recording' : 'Start recording'}
          onPress={onMicPress}
          disabled={micDisabled}
          hitSlop={8}
          style={({ pressed }) => [
            styles.iconButton,
            { opacity: micDisabled ? 0.3 : pressed ? 0.5 : 1 },
          ]}
        >
          <Ionicons
            name={micActive ? 'stop-circle' : 'mic-outline'}
            size={22}
            color={micActive ? theme.danger : theme.iconMuted}
          />
        </Pressable>
      ) : null}

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Send"
        onPress={submit}
        disabled={!hasText || busy}
        style={({ pressed }) => [
          styles.send,
          {
            backgroundColor: hasText ? theme.accent : theme.backgroundSelected,
            opacity: pressed ? 0.8 : 1,
          },
        ]}
      >
        {busy ? (
          <ActivityIndicator size="small" color={theme.accentText} />
        ) : (
          <Ionicons
            name="arrow-up"
            size={20}
            color={hasText ? theme.accentText : theme.textSecondary}
          />
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  shell: {
    flexDirection: 'row',
    // alignItems is set inline: centred on one line, bottom-aligned once grown.
    gap: Spacing.two,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.card + 10,
    paddingLeft: Spacing.two,
    paddingRight: Spacing.two,
    paddingVertical: Spacing.two,
  },
  input: {
    flex: 1,
    fontSize: 16,
    lineHeight: LINE,
    // Zero padding is load-bearing: the animated height is the measured content height, so
    // any padding here would eat into the text's own space. The shell pads instead.
    padding: 0,
    // iOS multiline inputs default to centring; the reference grows downward from the top.
    textAlignVertical: 'top',
    ...(Platform.OS === 'web' ? { outlineWidth: 0 } : null),
  },
  iconButton: { padding: Spacing.one },
  send: {
    width: 36,
    height: 36,
    borderRadius: Radius.round,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
