import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useColorScheme } from 'react-native';

import '@/global.css';

export default function RootLayout() {
  const colorScheme = useColorScheme();

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <StatusBar style="auto" />
      <Stack>
        <Stack.Screen name="index" options={{ title: 'First Look' }} />
        <Stack.Screen name="job/[id]/capture" options={{ title: 'Live capture' }} />
        <Stack.Screen name="job/[id]/hidden" options={{ title: 'Hidden damage' }} />
        <Stack.Screen name="job/[id]/inspection" options={{ title: 'AI damage inspection' }} />
        <Stack.Screen name="job/[id]/send" options={{ title: 'Send to customer' }} />
      </Stack>
    </ThemeProvider>
  );
}
