import { DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

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
  return (
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
        {/* index and job/[id]/hidden set their own headers, so they can wire the
            hamburger and the re-run action to screen state. */}
        <Stack.Screen name="index" options={{ title: 'Partli' }} />
        <Stack.Screen name="case/[id]" options={{ title: 'Diagnosis' }} />
        {/* Legacy: the jobs API flow on apps/api. Superseded by case/[id]. */}
        <Stack.Screen name="job/[id]/capture" options={{ title: 'Live capture' }} />
        <Stack.Screen name="job/[id]/hidden" options={{ title: 'Diagnosis' }} />
        <Stack.Screen name="job/[id]/send" options={{ title: 'Send to customer' }} />
      </Stack>
    </ThemeProvider>
  );
}
