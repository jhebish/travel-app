import { useFonts } from "expo-font";
import { Stack, useRouter, useSegments } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AuthProvider, useAuth } from "../src/auth";
import { NotificationsBridge } from "../src/notifications";
import { FONT, useTheme } from "../src/theme";

// Keep the splash screen up until the fonts are in, so text never flashes in the system font.
SplashScreen.preventAutoHideAsync().catch(() => {});

function Gate() {
  const { session, ready } = useAuth();
  const segments = useSegments();
  const router = useRouter();
  const t = useTheme();
  useEffect(() => {
    if (!ready) return;
    const onLogin = segments[0] === "login";
    if (segments[0] === "auth-callback") return; // finishing a sign-in link
    // Guests use the app freely; sign-in is optional. Only fall back to the sign-in
    // screen if no session (not even a guest one) could be started.
    if (!session && !onLogin) router.replace("/login");
    if (session && !session.user.is_anonymous && onLogin) router.replace("/");
  }, [session, ready, segments, router]);
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: t.bg },
        headerTintColor: t.ink,
        headerTitleStyle: { fontFamily: FONT.display, fontSize: 18 },
        headerBackTitleStyle: { fontFamily: FONT.body },
        contentStyle: { backgroundColor: t.bg },
        headerShadowVisible: false,
      }}
    >
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="login" options={{ title: "Sign in" }} />
      <Stack.Screen name="trip/[id]" options={{ title: "Trip" }} />
      <Stack.Screen name="auth-callback" options={{ title: "Signing in", headerBackVisible: false }} />
      <Stack.Screen name="rank" options={{ title: "Rank" }} />
    </Stack>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    [FONT.display]: require("../assets/fonts/Marcellus-Regular.ttf"),
    [FONT.body]: require("../assets/fonts/EBGaramond-Regular.ttf"),
    [FONT.medium]: require("../assets/fonts/EBGaramond-Medium.ttf"),
    [FONT.semibold]: require("../assets/fonts/EBGaramond-SemiBold.ttf"),
    [FONT.italic]: require("../assets/fonts/EBGaramond-Italic.ttf"),
  });
  // A font that fails to load falls back to the system font rather than keeping the app closed.
  const ready = fontsLoaded || !!fontError;
  useEffect(() => {
    if (ready) SplashScreen.hideAsync().catch(() => {});
  }, [ready]);
  if (!ready) return null;
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <StatusBar style="auto" />
        <Gate />
        <NotificationsBridge />
      </AuthProvider>
    </SafeAreaProvider>
  );
}
