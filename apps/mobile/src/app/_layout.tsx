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
          headerTintColor: Colors.light.text,
          headerStyle: { backgroundColor: Colors.light.background },
        }}
      >
        <Stack.Screen name="index" options={{ title: 'Partli' }} />
        <Stack.Screen name="job/[id]/capture" options={{ title: 'Live capture' }} />
        <Stack.Screen name="job/[id]/hidden" options={{ title: 'Hidden damage' }} />
        <Stack.Screen name="job/[id]/send" options={{ title: 'Send to customer' }} />
      </Stack>
    </ThemeProvider>
  );
}
