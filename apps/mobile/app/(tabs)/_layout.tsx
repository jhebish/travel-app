import { Tabs } from "expo-router";
import { Text, type ColorValue } from "react-native";
import { useTheme } from "../../src/theme";

const icon = (glyph: string) =>
  function TabIcon({ color }: { color: ColorValue }) {
    return <Text style={{ color, fontSize: 18 }}>{glyph}</Text>;
  };

export default function TabsLayout() {
  const t = useTheme();
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: t.bg },
        headerTintColor: t.ink,
        headerShadowVisible: false,
        tabBarStyle: { backgroundColor: t.surface, borderTopColor: t.line },
        tabBarActiveTintColor: t.accent,
        tabBarInactiveTintColor: t.muted,
      }}
    >
      <Tabs.Screen name="index" options={{ title: "Plan", tabBarIcon: icon("✦") }} />
      <Tabs.Screen name="trips" options={{ title: "My trips", tabBarIcon: icon("☰") }} />
      <Tabs.Screen name="sources" options={{ title: "My mix", tabBarIcon: icon("◐") }} />
      <Tabs.Screen name="you" options={{ title: "You", tabBarIcon: icon("◉") }} />
    </Tabs>
  );
}
