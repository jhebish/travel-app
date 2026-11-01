import { useColorScheme } from "react-native";
import type { SourceId } from "@travel/core";

// Same system as the web app: limestone ground, blue-black ink, one Majorelle-cobalt accent.
const light = {
  bg: "#f3f4f1", surface: "#ffffff", sunk: "#eceee9", ink: "#161b2e", muted: "#5e6475", faint: "#8a90a2", line: "#e2e4e9",
  accent: "#2f45d8", accentInk: "#ffffff", accentSoft: "#e6e9fb", hero: "#2f45d8", heroInk: "#ffffff", heroSoft: "rgba(255,255,255,0.78)",
  saffron: "#e98f37", good: "#1f8a5b", bad: "#c53d3d",
  sources: { locals: "#2f45d8", hosts: "#1f8a5b", press: "#7c4ddb", indie: "#d08014", reviews: "#8a90a2", guidebooks: "#b4532a", social: "#d23b7f", sponsored: "#c53d3d" } as Record<SourceId, string>,
};
const dark: typeof light = {
  bg: "#0d1020", surface: "#151a2e", sunk: "#1b2138", ink: "#eceef6", muted: "#a0a6ba", faint: "#737a90", line: "#262c44",
  accent: "#8090ff", accentInk: "#0d1020", accentSoft: "#1f2654", hero: "#2a3ab5", heroInk: "#ffffff", heroSoft: "rgba(255,255,255,0.8)",
  saffron: "#f2a65e", good: "#4cc08a", bad: "#ec6b6b",
  sources: { locals: "#8090ff", hosts: "#4cc08a", press: "#a985f2", indie: "#eaa443", reviews: "#8e94a8", guidebooks: "#dd8a5c", social: "#ec7bab", sponsored: "#ec6b6b" },
};

export type Theme = typeof light;
export const useTheme = (): Theme => (useColorScheme() === "dark" ? dark : light);
