import localFont from "next/font/local";

/**
 * The site's type, served from pylos.ai itself rather than Google Fonts: no third-party
 * stylesheet to wait for before the first paint, the Latin files preloaded, and a fallback font
 * sized to match so text doesn't jump when the real font arrives.
 *
 * Each face comes in two files: Latin (preloaded) and Latin Extended (accented letters beyond
 * Latin-1, such as ł, ő, ș, ğ), which the browser fetches only when a page uses one. In the
 * stacks (globals.css) the Extended face comes first: its unicode-range limits it to those letters.
 * next/font needs every option written out as a literal, so the range is repeated.
 */
/** EB Garamond for reading (variable weight, roman and italic). */
export const garamond = localFont({
  src: [
    { path: "./_fonts/eb-garamond-latin-wght-normal.woff2", weight: "400 800", style: "normal" },
    { path: "./_fonts/eb-garamond-latin-wght-italic.woff2", weight: "400 800", style: "italic" },
  ],
  variable: "--font-garamond",
  display: "swap",
  adjustFontFallback: "Times New Roman",
});
export const garamondExt = localFont({
  src: [
    { path: "./_fonts/eb-garamond-latin-ext-wght-normal.woff2", weight: "400 800", style: "normal" },
    { path: "./_fonts/eb-garamond-latin-ext-wght-italic.woff2", weight: "400 800", style: "italic" },
  ],
  variable: "--font-garamond-ext",
  display: "swap",
  preload: false,
  adjustFontFallback: false,
  declarations: [{ prop: "unicode-range", value: "U+0100-02AF, U+0304, U+0308, U+0329, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF" }],
});

/** Marcellus, the inscription capitals, for headings, labels and buttons. */
export const marcellus = localFont({
  src: "./_fonts/marcellus-latin-400-normal.woff2",
  weight: "400",
  variable: "--font-marcellus",
  display: "swap",
  adjustFontFallback: "Times New Roman",
});
export const marcellusExt = localFont({
  src: "./_fonts/marcellus-latin-ext-400-normal.woff2",
  weight: "400",
  variable: "--font-marcellus-ext",
  display: "swap",
  preload: false,
  adjustFontFallback: false,
  declarations: [{ prop: "unicode-range", value: "U+0100-02AF, U+0304, U+0308, U+0329, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF" }],
});

/** Classes that define the font variables; set on <html>. */
export const fontVariables = [garamond, garamondExt, marcellus, marcellusExt].map((f) => f.variable).join(" ");
