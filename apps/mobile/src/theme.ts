import { useColorScheme } from "react-native";
import type { SourceId } from "@travel/core";

// Same system as the web app (Aegean): whitewash ground, pale sea-blue hero, one deep Aegean blue accent.
const light = {
  bg: "#f7f4ee", surface: "#fffefb", sunk: "#eef0ef", ink: "#1e2a3a", muted: "#566273", faint: "#7f8896", line: "#e3e1d8",
  accent: "#2e5e8c", accentInk: "#ffffff", accentSoft: "#dde9f2", hero: "#dce8f1", heroInk: "#1e2a3a", heroSoft: "#3f4d60",
  saffron: "#c08a3e", good: "#4f6d3c", bad: "#b04a3e",
  sources: { locals: "#2e5e8c", hosts: "#5f7a4a", press: "#7a5c93", indie: "#a8742c", reviews: "#7f8896", guidebooks: "#a85a3c", social: "#b5527a", sponsored: "#b04a3e" } as Record<SourceId, string>,
};
const dark: typeof light = {
  bg: "#0f1722", surface: "#16202d", sunk: "#1c2837", ink: "#eef1f4", muted: "#a7b1bd", faint: "#7d8897", line: "#27354a",
  accent: "#8db6dc", accentInk: "#0f1722", accentSoft: "#1d3149", hero: "#1b2b3e", heroInk: "#eef1f4", heroSoft: "#b9c6d4",
  saffron: "#e0ad6a", good: "#9db884", bad: "#e07c6e",
  sources: { locals: "#8db6dc", hosts: "#9db884", press: "#b59ad0", indie: "#e0ad6a", reviews: "#8a95a3", guidebooks: "#dd9470", social: "#e08bb0", sponsored: "#e07c6e" },
};

export type Theme = typeof light;
export const useTheme = (): Theme => (useColorScheme() === "dark" ? dark : light);
