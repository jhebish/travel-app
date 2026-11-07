import Ionicons from "@expo/vector-icons/Ionicons";
import { Tabs } from "expo-router";
import type { ComponentProps } from "react";
import type { ColorValue } from "react-native";
import { FONT, useTheme } from "../../src/theme";

type IconName = ComponentProps<typeof Ionicons>["name"];
const icon = (name: IconName) =>
  function TabIcon({ color, focused }: { color: ColorValue; focused: boolean }) {
    return <Ionicons name={focused ? (name.replace("-outline", "") as IconName) : name} size={23} color={String(color)} />;
  };

export default function TabsLayout() {
  const t = useTheme();
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: t.bg },
        headerTintColor: t.ink,
        headerTitleStyle: { fontFamily: FONT.display, fontSize: 18 },
        headerShadowVisible: false,
        tabBarStyle: { backgroundColor: t.surface, borderTopColor: t.line },
        tabBarActiveTintColor: t.accent,
        tabBarInactiveTintColor: t.muted,
        // The site's tab bar: small tracked inscription capitals.
        tabBarLabelStyle: { fontFamily: FONT.display, fontSize: 10.5, letterSpacing: 1, textTransform: "uppercase" },
      }}
    >
      <Tabs.Screen name="index" options={{ title: "Plan", tabBarIcon: icon("compass-outline") }} />
      <Tabs.Screen name="trips" options={{ title: "My trips", tabBarIcon: icon("briefcase-outline") }} />
      <Tabs.Screen name="sources" options={{ title: "My mix", tabBarIcon: icon("options-outline") }} />
      <Tabs.Screen name="you" options={{ title: "You", tabBarIcon: icon("person-circle-outline") }} />
    </Tabs>
  );
}
