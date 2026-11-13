/**
 * The Pylos mark: a Greek T-strap sandal with a gold wing at the ankle, after Hermes' talaria.
 *
 * The sandal is drawn flat and `MARK_FRAME` tilts it 14° (heel up, toe down, mid-stride) and centres
 * it on a 200×200 square. The sandal is ink on light grounds and cream on dark or teal ones; the
 * wing is always gold. Three cuts keep it legible as it shrinks: `full` (about 80px and up), `mid`
 * (about 40–80px) and `tiny` (favicons, about 32px and under).
 *
 * Beside the wordmark (see `.brand` in the web app's globals.css): the drawing stands twice the
 * capitals' height, its toe resting just under the baseline, 0.4em from the P.
 *
 * The static favicon (apps/web/src/app/icon.svg), the email lockup (apps/web/public/email/) and the
 * mobile app's icon PNGs are drawn from these same paths; regenerate them if the mark changes.
 */
export const MARK_VIEWBOX = "0 0 200 200";
/** Just the drawing, for lockups beside the wordmark: about 7:5, every cut fits. */
export const MARK_VIEWBOX_TIGHT = "27 47.5 143 103";
/** How far the sandal leans, in degrees clockwise: the heel lifts and the toe points down. */
export const MARK_TILT = 14;
/** Tilts the flat drawing and centres the full cut on (100, 100), 133 wide and 96 tall. */
export const MARK_FRAME = `translate(100 100) scale(0.899) translate(-60.75 -142.3) rotate(${MARK_TILT})`;

export const MARK_SOLE =
  "M38 152 C38 146 42 143 50 143 L156 146 C167 146.5 175 149 177 153 C178 157 174 159 166 159 L48 161 C42 161 38 158 38 152 Z";
export const MARK_WING =
  "M4 6 C2 -10 -12 -26 -36 -38 C-50 -45 -62 -48 -74 -50 C-66 -42 -58 -37 -50 -33 C-62 -31 -72 -28 -80 -23 C-68 -18 -58 -16 -48 -16 C-56 -10 -62 -4 -66 3 C-44 8 -20 10 4 6 Z";

export type MarkCut = "full" | "mid" | "tiny";

/** Per cut: the straps (stroked), their width, a stroke on the sole to thicken it, and where the wing sits. */
export const MARK_CUTS: Record<MarkCut, { straps: string; strap: number; sole: number; wing: string }> = {
  full: {
    straps:
      "M50 147 C47 134 50 122 60 114 M60 114 C68 106 88 105 96 112 M96 112 C114 118 134 129 151 140 M151 140 L150 147 M84 147 C94 137 104 128 114 121 M112 147 C120 140 128 134 136 130",
    strap: 8,
    sole: 0,
    wing: "translate(62 112) rotate(-8) scale(0.6)",
  },
  mid: {
    straps: "M50 147 C47 134 50 122 60 114 M60 114 C68 106 88 105 96 112 M96 112 C114 118 134 129 151 140 M151 140 L150 147 M90 147 C100 136 110 128 120 122",
    strap: 11,
    sole: 3,
    wing: "translate(62 112) rotate(-8) scale(0.64)",
  },
  tiny: {
    straps: "M50 147 C47 134 50 122 60 114 M60 114 C68 106 88 105 96 112 M96 112 C114 118 134 129 151 140 M151 140 L150 147 M92 147 C101 137 110 129 120 123",
    strap: 13,
    sole: 5,
    wing: "translate(62 112) rotate(-8) scale(0.68)",
  },
};

/** The cut for a mark drawn `px` wide (on the 200 square). */
export const markCut = (px: number): MarkCut => (px >= 80 ? "full" : px > 36 ? "mid" : "tiny");

export const BRAND = {
  ink: "#3b2d36",
  cream: "#f6f0e8",
  paper: "#fffdf9",
  teal: "#3f7472",
  /** The wing on light grounds. */
  gold: "#b8924a",
  /** The wing on dark and teal grounds. */
  goldLight: "#e9b872",
  /** The wordmark: Marcellus capitals, tracked. */
  wordmarkTracking: "0.16em",
} as const;
