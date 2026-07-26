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
    /** The page. Near-white — the cards carry the structure, not a grey field. */
    background: '#FFFFFF',
    /** Cards: a hair off the page, so an edge reads without a heavy border. */
    backgroundElement: '#FAFAFC',
    /** The inactive filter pill, and any tinted-but-not-solid surface. */
    backgroundSelected: '#EEECFD',
    textSecondary: '#8A909C',
    border: '#ECEDF1',
    accent: '#5B4FE8',
    accentText: '#FFFFFF',
    iconMuted: '#A0A4AE',
    cropMark: '#D6D8DE',
    /** Tinted accent surfaces: the strong match badge, a moved row. */
    badgeFill: '#EEECFD',
    badgeText: '#5B4FE8',
    success: '#14804A',
    danger: '#B3261E',
    warning: '#8A5A1A',
  },
  dark: {
    text: '#E9EAEF',
    background: '#0E0F14',
    backgroundElement: '#171922',
    backgroundSelected: '#241F44',
    textSecondary: '#9195A3',
    border: '#262936',
    accent: '#8B82F5',
    accentText: '#0E0F14',
    iconMuted: '#7A7F8F',
    cropMark: '#393D4C',
    badgeFill: '#241F44',
    badgeText: '#B7B0FA',
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

/**
 * The intake screen's own palette and faces.
 *
 * Kept beside the app tokens rather than folded into them: this screen is a
 * deliberately quieter, editorial treatment — paper-white, hairline rules, one
 * accent — and flattening it into `Colors` would drag the rest of the app with
 * it. Values are the redesign spec's, verbatim.
 */
export const Intake = {
  accent: '#4B47FF',
  accentHover: '#3A37D6',
  /** The pale accent family: inactive tab fill, its border, its text. */
  accentPale: '#ECEBFF',
  accentPaleBorder: '#DEDCFF',
  accentPaleText: '#3B38C9',
  /** Answer chips on the question card. */
  answerChipBorder: '#C9C7FF',

  ink: '#15141A',
  body: '#6F6D6A',
  mutedLabel: '#B0AEAA',
  secondary: '#8D8A84',

  /** Region rules; chip and field borders. */
  ruleFooter: '#F0EEEA',
  ruleInput: '#DCDAD6',
  ruleChip: '#E8E6E2',

  /** Cards and the composer sit a shade off the page so their edge reads. */
  surface: '#FBFBFA',
  composer: '#FBFBFA',
  chipFill: '#F6F5F2',
  page: '#FFFFFF',

  /** The 3D panel, and the two things it marks. */
  panel: '#15141A',
  markerVisible: '#EF6B52',
  markerPredicted: '#8A86FF',

  success: '#1F9D63',
  buttonIdle: '#F2F1EE',
  buttonIdleText: '#ADABA7',

  /** 22px either side, on every screen. */
  gutter: 22,
} as const;

/** Corner radii, by what they belong to. */
export const Round = {
  pill: 999,
  composer: 16,
  media: 14,
  card: 12,
  tab: 10,
  answerChip: 9,
} as const;

/** The three faces, by the names `useFonts` registered them under. */
export const Faces = {
  headline: 'Oswald_600SemiBold',
  /** Oswald 400 — the large confidence numeral on a part card. */
  headlineLight: 'Oswald_400Regular',
  sans: 'DMSans_400Regular',
  sansMedium: 'DMSans_500Medium',
  sansSemi: 'DMSans_600SemiBold',
  plate: 'IBMPlexMono_500Medium',
} as const;

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
