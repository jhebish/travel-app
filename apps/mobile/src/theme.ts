import { useColorScheme } from "react-native";
import type { SourceId } from "@travel/core";

const light = {
  bg: "#f2f5f4", surface: "#ffffff", ink: "#15211e", muted: "#5d6c68", line: "#d9e1df",
  accent: "#1d5aa8", accentInk: "#ffffff", accentSoft: "#e3ecf8", saffron: "#c98208", good: "#2e7d5b", bad: "#b33a3a",
  sources: { locals: "#1d5aa8", hosts: "#2e7d5b", press: "#8a4fb5", indie: "#c98208", reviews: "#7a8784", guidebooks: "#a0522d", social: "#c2417a", sponsored: "#b33a3a" } as Record<SourceId, string>,
};
const dark: typeof light = {
  bg: "#0f1514", surface: "#18201f", ink: "#e6eeeb", muted: "#97a7a3", line: "#2a3533",
  accent: "#6ea3ec", accentInk: "#0b1420", accentSoft: "#1c2a3d", saffron: "#e8a83a", good: "#5cc195", bad: "#e06b6b",
  sources: { locals: "#6ea3ec", hosts: "#5cc195", press: "#b98be0", indie: "#e8a83a", reviews: "#9aa8a5", guidebooks: "#d98a5c", social: "#e57aa8", sponsored: "#e06b6b" },
};

export type Theme = typeof light;
export const useTheme = (): Theme => (useColorScheme() === "dark" ? dark : light);
