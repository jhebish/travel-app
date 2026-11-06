/** Small helpers shared by the signal builders: text folding, cleaning, clipping, hashing, dates. */

/**
 * Lower-case, accent-free text with punctuation turned into single spaces, used for keyword
 * matching and for comparing names: "Café-Bar & Grill" → "cafe bar and grill". Letters in
 * other scripts (Japanese, Cyrillic, Arabic…) are kept.
 */
export function fold(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}\p{M}]+/gu, " ")
    .trim();
}

/** fold() without a leading "the", for matching place names: "The Hoxton" = "Hoxton". */
export const nameKey = (s: string) => fold(s).replace(/^the /, "");

/**
 * Remove what a database can't store or a page can't show: control characters (NUL makes
 * Postgres reject the whole batch) and halves of emoji left by bad data or cutting.
 */
export const cleanText = (s: string) =>
  s.replace(/[\u0000-\u0008\u000E-\u001F\u007F]/g, "").replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "");

/** Collapse whitespace and clip to `max` characters, cutting at a word and adding "…" when needed. */
export function clip(s: string | null | undefined, max: number): string {
  const t = cleanText(s ?? "").replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  let cut = t.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  if (space > max * 0.6) cut = cut.slice(0, space);
  if (/[\uD800-\uDBFF]$/.test(cut)) cut = cut.slice(0, -1); // don't split an emoji
  return cut.replace(/[\s,.;:–—-]+$/, "") + "…";
}

/** Stable 53-bit string hash (cyrb53), base 36. Used for refs when an event has no id. */
export function hashString(s: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/** Checks a YYYY-MM-DD string is a real day between 1990 and 2100. */
export function validDay(ymd: string): string | null {
  const m = ymd.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (y < 1990 || y >= 2100 || mo < 1 || mo > 12 || d < 1) return null;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d ? ymd : null;
}

/** The calendar day at the start of an ISO-ish string: "2019-06-02T10:20:30Z", "2019-06-02 10:20". */
export function dateFromText(value: string): string | null {
  const m = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? validDay(`${m[1]}-${m[2]}-${m[3]}`) : null;
}
