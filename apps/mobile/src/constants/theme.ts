/**
 * Design tokens, taken from the Partli mockups.
 *
 * The look is: warm light-grey page, near-black text with a blue cast, one slate-blue
 * accent, hairline borders, and crop-mark ticks at the corners of framed content.
 * Only the light palette is used today (see `hooks/use-theme.ts`); the dark values are
 * kept in step so switching back to following the OS stays a one-line change.
 */

import '@/global.css';

import { Platform, type TextStyle } from 'react-native';

export const Colors = {
  light: {
    text: '#191C1F',
    background: '#F1F1EF',
    /** Cards and the prompt box: a shade lighter than the page. */
    backgroundElement: '#F7F7F5',
    backgroundSelected: '#E4E6E4',
    textSecondary: '#5F6570',
    border: '#D6D8D9',
    accent: '#5B7A9D',
    accentText: '#FFFFFF',
    /** Leading icons in the prompt box and suggestion rows. */
    iconMuted: '#7C96B4',
    /** The little `+` ticks that frame a card. */
    cropMark: '#B4B8BB',
    /** Filled match badges and numbered step badges. */
    badgeFill: '#E4E9EF',
    badgeText: '#44607F',
    success: '#2F6B46',
    danger: '#A93636',
    warning: '#8A5A1A',
  },
  dark: {
    text: '#ECEDEE',
    background: '#16181A',
    backgroundElement: '#1F2225',
    backgroundSelected: '#2C3033',
    textSecondary: '#A0A6AE',
    border: '#33383C',
    accent: '#8FAECF',
    accentText: '#10161C',
    iconMuted: '#7C96B4',
    cropMark: '#4A4F54',
    badgeFill: '#25303C',
    badgeText: '#A9C4DE',
    success: '#6BC08C',
    danger: '#E08585',
    warning: '#D8A24A',
  },
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

export const Fonts = Platform.select({
  ios: {
    /** iOS `UIFontDescriptorSystemDesignDefault` */
    sans: 'system-ui',
    /** iOS `UIFontDescriptorSystemDesignSerif` */
    serif: 'ui-serif',
    /** iOS `UIFontDescriptorSystemDesignRounded` */
    rounded: 'ui-rounded',
    /** iOS `UIFontDescriptorSystemDesignMonospaced` */
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: 'var(--font-display)',
    serif: 'var(--font-serif)',
    rounded: 'var(--font-rounded)',
    mono: 'var(--font-mono)',
  },
});

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

/** Minimum tap target. The spec assumes gloves, so nothing interactive goes below this. */
export const TapTarget = 56;

export const Radius = {
  /** Match badges and small chips. */
  chip: 6,
  card: 14,
  /** The prompt box and the drawer's New chat button. */
  prompt: 4,
  round: 999,
} as const;

export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 800;

/**
 * Spread into a TextInput's style to kill the browser focus ring.
 *
 * React Native Web renders TextInput as an <input>, which the browser outlines in blue
 * on focus — nothing React Native's own types describe, hence the cast. No-op on native.
 */
export const NoFocusRing =
  Platform.OS === 'web' ? ({ outlineStyle: 'none' } as unknown as TextStyle) : null;
