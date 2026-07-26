import { DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import {
  DMSans_400Regular,
  DMSans_500Medium,
  DMSans_600SemiBold,
} from '@expo-google-fonts/dm-sans';
import { IBMPlexMono_500Medium } from '@expo-google-fonts/ibm-plex-mono';
import {
  Oswald_400Regular,
  Oswald_600SemiBold,
  useFonts,
} from '@expo-google-fonts/oswald';

import { Colors } from '@/constants/theme';
import '@/global.css';

/**
 * Partli is light-only for now, so the navigation theme is pinned to light rather
 * than following the OS. See `hooks/use-theme.ts` to put it back.
 */
const navigationTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background: Colors.light.background,
    card: Colors.light.background,
    text: Colors.light.text,
    border: Colors.light.border,
    primary: Colors.light.accent,
  },
};

export default function RootLayout() {
  // Oswald carries the headlines — uppercase, condensed, one weight. DM Sans
  // every other piece of UI text, IBM Plex Mono the registration plates.
  // Loaded here rather than per-screen so the first paint anywhere already has
  // them and nothing reflows.
  const [fontsLoaded] = useFonts({
    Oswald_400Regular,
    Oswald_600SemiBold,
    DMSans_400Regular,
    DMSans_500Medium,
    DMSans_600SemiBold,
    IBMPlexMono_500Medium,
  });

  // Holding the tree back a beat beats rendering in the system face and
  // snapping — the headline is 40px, so the swap would be impossible to miss.
  if (!fontsLoaded) return null;

  return (
    <SafeAreaProvider>
      <ThemeProvider value={navigationTheme}>
        <StatusBar style="dark" />
        <Stack
          screenOptions={{
            headerShadowVisible: false,
            headerTintColor: Colors.light.accent,
            headerTitleStyle: { color: Colors.light.text, fontWeight: '700' },
            headerStyle: { backgroundColor: Colors.light.background },
            contentStyle: { backgroundColor: Colors.light.background },
          }}
        >
          {/* index sets its own header, so it can wire the hamburger to screen state.
              Without this the header falls back to printing the route path. The 3D model
              lives inline on the report now (case-report.tsx) rather than its own route. */}
          <Stack.Screen name="index" options={{ title: 'Partli' }} />
          <Stack.Screen name="case/[id]" options={{ title: 'Diagnosis' }} />
          <Stack.Screen name="case/[id]/send" options={{ title: 'Send to customer' }} />
        </Stack>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
