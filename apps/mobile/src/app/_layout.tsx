import { DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { BrandTitleStyle, Colors } from '@/constants/theme';
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
              Without these two the header falls back to printing the route path. */}
          <Stack.Screen
            name="index"
            options={{ title: 'Partli', headerTitleStyle: BrandTitleStyle }}
          />
          <Stack.Screen name="case/[id]" options={{ title: 'Diagnosis' }} />
          <Stack.Screen name="case/[id]/send" options={{ title: 'Send to customer' }} />
          <Stack.Screen name="case/[id]/inspection" options={{ title: '3D inspection' }} />
        </Stack>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
