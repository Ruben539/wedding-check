import { DarkTheme, DefaultTheme, ThemeProvider, Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useColorScheme } from 'react-native';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { OfflineModal } from '@/components/offline-modal';
import { AuthProvider } from '@/context/auth-context';
import { EventProvider } from '@/context/event-context';
import { SyncProvider } from '@/context/sync-context';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const colorScheme = useColorScheme();
  return (
    <AuthProvider>
      <SyncProvider>
        <EventProvider>
          <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
            <AnimatedSplashOverlay />
            <Stack screenOptions={{ headerShown: false }}>
              <Stack.Screen name="(tabs)" />
              <Stack.Screen name="login" />
            </Stack>
            <OfflineModal />
          </ThemeProvider>
        </EventProvider>
      </SyncProvider>
    </AuthProvider>
  );
}
