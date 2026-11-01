import { Stack, useRouter, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AuthProvider, useAuth } from "../src/auth";
import { useTheme } from "../src/theme";

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
        contentStyle: { backgroundColor: t.bg },
        headerShadowVisible: false,
      }}
    >
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="login" options={{ title: "Sign in" }} />
      <Stack.Screen name="trip/[id]" options={{ title: "Trip" }} />
      <Stack.Screen name="auth-callback" options={{ title: "Signing in", headerBackVisible: false }} />
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <StatusBar style="auto" />
        <Gate />
      </AuthProvider>
    </SafeAreaProvider>
  );
}
