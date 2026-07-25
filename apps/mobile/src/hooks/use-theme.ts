import { Colors } from '@/constants/theme';

/**
 * Partli is light-only for now.
 *
 * The dark palette is still defined in `constants/theme.ts`, so switching this back
 * to following the OS is a one-line change:
 *   const scheme = useColorScheme();
 *   return Colors[scheme === 'dark' ? 'dark' : 'light'];
 */
export function useTheme() {
  return Colors.light;
}
