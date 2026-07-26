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

/**
 * The palette.
 *
 * Two rules it is built on, both for a phone held at the side of a car:
 *
 * 1. **Cards are white on grey.** They used to be `#F7F7F5` on `#F1F1EF` — a 2.5%
 *    difference, which is invisible in daylight and made every list read as one flat
 *    slab. A true-white surface on a cool grey page is the standard mobile grouped-list
 *    treatment because it survives glare.
 * 2. **One accent, two weights.** A mid navy for links and outlines, a darker navy for
 *    filled surfaces that carry white text. Everything else is greyscale, so the only
 *    colour on the screen means "this is actionable" — apart from the semantic
 *    success/danger pair on the ✓/✗ pair, which must stay distinguishable.
 */
export const Colors = {
  light: {
    text: '#101828',
    background: '#F2F4F7',
    /** Cards and the prompt box: a shade lighter than the page. */
    backgroundElement: '#FFFFFF',
    backgroundSelected: '#E7EBF0',
    textSecondary: '#5B6472',
    border: '#E3E7EC',
    accent: '#3D5A80',
    accentText: '#FFFFFF',
    /** Leading icons in the prompt box and suggestion rows. */
    iconMuted: '#7C8CA3',
    /** The little `+` ticks that frame a card. */
    cropMark: '#C3C9D1',
    /** Filled match badges and numbered step badges. */
    badgeFill: '#E8EEF6',
    badgeText: '#2C4763',
    success: '#14804A',
    danger: '#B3261E',
    warning: '#8A5A1A',
  },
  dark: {
    text: '#E9EDF2',
    background: '#101418',
    backgroundElement: '#191F26',
    backgroundSelected: '#232B34',
    textSecondary: '#9AA5B1',
    border: '#2A323B',
    accent: '#8FB3DA',
    accentText: '#0B1016',
    iconMuted: '#7C8CA3',
    cropMark: '#3A434D',
    badgeFill: '#1D2A38',
    badgeText: '#A9C6E6',
    success: '#45C486',
    danger: '#F2837B',
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
