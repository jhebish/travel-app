import { useColorScheme } from "react-native";
import type { SourceId } from "@travel/core";

// Same system as the web app: pastel palette on warm paper, plum ink, sea-teal accent.
const light = {
  bg: "#f6f0e8", surface: "#fffdf9", sunk: "#efe7dc", ink: "#3b2d36", muted: "#6a5a63", faint: "#8e7f87", line: "#e4d9cc",
  accent: "#3f7472", accentInk: "#ffffff", accentSoft: "#cde3e2", hero: "#d5e4c8", heroInk: "#3b2d36", heroSoft: "#4e4248",
  saffron: "#b8924a", good: "#4f6b47", bad: "#a84a42", btn: "#3b2d36", btnInk: "#fbf6ef", ochre: "#f3e1b6", clay: "#f0d5d0", olive: "#4f6b47",
  sources: { locals: "#3f7472", hosts: "#6b8a5a", press: "#8a6aa0", indie: "#b8924a", reviews: "#8e7f87", guidebooks: "#b06a52", social: "#b5607f", sponsored: "#a84a42", friends: "#4f79a8" } as Record<SourceId, string>,
};
const dark: typeof light = {
  bg: "#1d171c", surface: "#261e24", sunk: "#2e252c", ink: "#f3ebe4", muted: "#c0b2b9", faint: "#93848c", line: "#3b3038",
  accent: "#9fcfcc", accentInk: "#1d171c", accentSoft: "#2a3d3c", hero: "#2c3627", heroInk: "#f3ebe4", heroSoft: "#cfd8c6",
  saffron: "#dcb56d", good: "#b5c9a2", bad: "#e08a7e", btn: "#f0d5d0", btnInk: "#2c2129", ochre: "#3d3322", clay: "#4a2f2c", olive: "#b5c9a2",
  sources: { locals: "#9fcfcc", hosts: "#a9c493", press: "#c3a5d8", indie: "#dcb56d", reviews: "#a0929a", guidebooks: "#e0a184", social: "#e39bb6", sponsored: "#e08a7e", friends: "#9dbde0" },
};

export type Theme = typeof light;
export const useTheme = (): Theme => (useColorScheme() === "dark" ? dark : light);

/**
 * The site's type: Marcellus (inscription capitals) for headings and buttons, EB Garamond for
 * reading. Loaded at startup in app/_layout.tsx; names match each file's PostScript name.
 */
export const FONT = {
  display: "Marcellus-Regular",
  body: "EBGaramond-Regular",
  medium: "EBGaramond-Medium",
  semibold: "EBGaramond-SemiBold",
  italic: "EBGaramond-Italic",
} as const;
