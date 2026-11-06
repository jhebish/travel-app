import { COUNTRIES, countryName } from "../countries";
import type { SignalKind, SignalSource, TasteSignal } from "../taste";
import { canonicalCity, knownCity } from "./cities";
import { cleanText, clip, fold, hashString, validDay } from "./text";

/** calendarSignals never returns more than this many signals. */
export const MAX_IMPORT_SIGNALS = 5000;

// ---------------------------------------------------------------------------
// Countries
// ---------------------------------------------------------------------------

/** Alternative and local country names → ISO code. Keys are written naturally and folded at load. */
const COUNTRY_ALIASES: Record<string, string> = {
  USA: "US", "U.S.A.": "US", US: "US", "U.S.": "US", "United States of America": "US", America: "US", "Estados Unidos": "US", EEUU: "US",
  "États-Unis": "US", "Vereinigte Staaten": "US", "Stati Uniti": "US",
  UK: "GB", "U.K.": "GB", "Great Britain": "GB", Britain: "GB", England: "GB", Scotland: "GB", Wales: "GB", "Northern Ireland": "GB",
  "Reino Unido": "GB", "Royaume-Uni": "GB", "Vereinigtes Königreich": "GB", "Regno Unito": "GB",
  UAE: "AE", "U.A.E.": "AE", Emirates: "AE", "Emirados Árabes Unidos": "AE", "Emiratos Árabes Unidos": "AE",
  Turkey: "TR", Turquía: "TR", Turquie: "TR", Türkei: "TR", "Czech Republic": "CZ", Česko: "CZ", "Česká republika": "CZ",
  Korea: "KR", "Republic of Korea": "KR", "Korea, South": "KR", "Corea del Sur": "KR", "Corée du Sud": "KR", 대한민국: "KR", 한국: "KR",
  "Russian Federation": "RU", Россия: "RU", "Viet Nam": "VN", Holland: "NL", Nederland: "NL", "Países Bajos": "NL", "Pays-Bas": "NL",
  Niederlande: "NL", "Paesi Bassi": "NL", Deutschland: "DE", Alemania: "DE", Allemagne: "DE", Germania: "DE", Alemanha: "DE",
  España: "ES", Spanien: "ES", Espagne: "ES", Spagna: "ES", Espanha: "ES", Italia: "IT", Italie: "IT", Italien: "IT", Portogallo: "PT",
  Frankreich: "FR", Francia: "FR", França: "FR", Mexique: "MX", Mexiko: "MX", Messico: "MX", Brasil: "BR", Brésil: "BR", Brasilien: "BR",
  Schweiz: "CH", Suisse: "CH", Svizzera: "CH", Suiza: "CH", Suíça: "CH", Österreich: "AT", Belgique: "BE", België: "BE", Belgien: "BE",
  Bélgica: "BE", Hellas: "GR", Ellada: "GR", Ελλάδα: "GR", Grecia: "GR", Grèce: "GR", Griechenland: "GR", Japón: "JP", Giappone: "JP",
  Japão: "JP", 日本: "JP", Chine: "CN", Cina: "CN", 中国: "CN", Maroc: "MA", Marruecos: "MA", Marokko: "MA", Marocco: "MA",
  Égypte: "EG", Egipto: "EG", Ägypten: "EG", Egitto: "EG", مصر: "EG", Liban: "LB", Líbano: "LB", لبنان: "LB", Danmark: "DK",
  Dinamarca: "DK", Sverige: "SE", Suecia: "SE", Norge: "NO", Noruega: "NO", Suomi: "FI", Éire: "IE", Irlanda: "IE", Polska: "PL",
  Polonia: "PL", Magyarország: "HU", Hrvatska: "HR", Croacia: "HR", Tailandia: "TH", ประเทศไทย: "TH", Sudáfrica: "ZA", "Suid-Afrika": "ZA",
  "Hong Kong SAR": "HK", "Hong Kong SAR China": "HK", 香港: "HK", Macau: "MO", "Macau SAR": "MO", "Macao SAR": "MO", 台灣: "TW", 台湾: "TW",
  Vatican: "VA", "Holy See": "VA", "Vatican City State": "VA", "Città del Vaticano": "VA", "Ivory Coast": "CI", "Cape Verde": "CV",
  Swaziland: "SZ", Burma: "MM", Macedonia: "MK", "Democratic Republic of the Congo": "CD", DRC: "CD", "Republic of the Congo": "CG",
  "Palestinian Territories": "PS", "Lao PDR": "LA", "Brunei Darussalam": "BN", KSA: "SA", "East Timor": "TL", "St Kitts and Nevis": "KN",
  "St Lucia": "LC", "St Vincent and the Grenadines": "VC", "Turks and Caicos": "TC", "US Virgin Islands": "VI",
};

const COUNTRY_BY_NAME = new Map<string, string>();
for (const [code, name] of COUNTRIES) COUNTRY_BY_NAME.set(countryKey(name), code);
for (const [alias, code] of Object.entries(COUNTRY_ALIASES)) COUNTRY_BY_NAME.set(countryKey(alias), code);

function countryKey(s: string) {
  return fold(s).replace(/^the /, "");
}

/** "Portugal", "USA", "Deutschland", "日本" → ISO code, else null. */
export function countryCodeFromName(name: string | null | undefined): string | null {
  return name ? COUNTRY_BY_NAME.get(countryKey(name)) ?? null : null;
}

/** An ISO-looking two-letter code ("pt" → "PT", "UK" → "GB"), else null. */
function asCountryCode(v: string | null | undefined): string | null {
  const t = v?.trim().toUpperCase() ?? "";
  if (!/^[A-Z]{2}$/.test(t)) return null;
  return t === "UK" ? "GB" : t;
}

/** Places where the country is the city. */
const CITY_STATES = new Set(["SG", "HK", "MO", "MC", "VA", "GI"]);

// ---------------------------------------------------------------------------
// Addresses
// ---------------------------------------------------------------------------

const STREET_START = /^(?:rua|r\.|calle|c\/|carrer|avenida|avenue|via|viale|vicolo|rue|boulevard|bd|travessa|largo|jalan|ulica|soi|chome|(?:av|avda|ave|blvd|jl|tv|ul)\.?)\s/i;
const STREET_END = /(?:\s(?:street|st\.?|road|rd\.?|avenue|ave\.?|boulevard|blvd\.?|lane|ln\.?|drive|dr\.?|way|highway|hwy\.?|str\.|weg|laan|straat|gracht|kade|steeg|vej|gade|gatan|vägen|veien|caddesi|cd\.|sokak|sk\.)|(?:strasse|straße|gasse))$/i;
const REGION = /\s(?:Province|State|Region|Oblast|Krai)$|^(?:Wilayah Persekutuan|Federal Territory|Metro\s|Provincia de|Province of|State of|Distrito Federal$)/i;

/** Remove postcode-like tokens: "1200-385 Lisboa" → "Lisboa", "London W1D 4HS" → "London", "1016 GV Amsterdam" → "Amsterdam". */
function stripPostcodes(part: string): string {
  const s = part
    .replace(/〒/g, " ")
    .replace(/\b\d{4}\s?[A-Z]{2}\b/g, " ") // Dutch
    .replace(/\s\d+-\D.*$/u, ""); // "Praha 1-Staré Město" → "Praha"
  return s
    .split(/\s+/)
    .filter((t) => t && !/^[A-Z]{0,3}-?\d[\dA-Z-]*$/i.test(t))
    .join(" ")
    .replace(/^[\s,.;:–—-]+|[\s,;:–—-]+$/g, "")
    .trim();
}

function cleanCity(part: string): string {
  let s = stripPostcodes(part);
  s = s.replace(/\s+[-–—]\s+\p{Lu}{2,3}$/u, ""); // "São Paulo - SP"
  if (s.includes("/")) s = s.split("/").pop()!.trim(); // "Beyoğlu/İstanbul"
  s = s.replace(/^(.*\p{Ll}.*?)\s+\p{Lu}{2,3}$/u, "$1"); // "Milano MI", "Sydney NSW", "Hong Kong SAR"
  s = s.replace(/\s+(?:Governorate|Prefecture|Metropolitan Municipality|Municipality)$/i, "");
  return s.replace(/^[\s,.;:–—-]+|[\s,;:–—-]+$/g, "").trim();
}

function acceptCity(c: string): boolean {
  if (c.length < 2 || c.length > 60 || !/\p{L}/u.test(c) || /\d/.test(c)) return false;
  if (/^[\p{Lu}.]{1,4}$/u.test(c) || /^(?:\p{Lu}\.){1,4}$/u.test(c)) return false; // NY, CDMX, Q.R., B.C.S.
  if (/^(?:\p{L}{1,4}\.\s?)+$/u.test(c)) return false; // "Oax.", "Edo. Méx."
  return !STREET_START.test(c) && !STREET_END.test(c) && !REGION.test(c);
}

export interface AddressParts {
  city: string | null;
  countryCode: string | null;
}

/**
 * City and country from a one-line address, reading from the end: the last part is usually the
 * country, the one before it the city (postcodes and state codes stripped):
 * "R. da Rosa 1, 1200-385 Lisboa, Portugal" → Lisbon, PT; "181 Thompson St, New York, NY 10012, USA" → New York, US.
 */
export function parseAddress(address: string | null | undefined): AddressParts {
  const raw = (address ?? "").replace(/\s+/g, " ").trim();
  if (!raw) return { city: null, countryCode: null };
  let parts = raw.split(/\s*[,，、،]\s*/).filter(Boolean);
  // Gulf-style "Downtown Dubai - Dubai - United Arab Emirates"
  const tail = parts[parts.length - 1] ?? "";
  if (/\s[-–—]\s/.test(tail)) {
    const segs = tail.split(/\s+[-–—]\s+/);
    if (countryCodeFromName(segs[segs.length - 1])) parts = [...parts.slice(0, -1), ...segs];
  }
  // A postcode after the country ("…, China, 200001")
  while (parts.length > 1 && !/\p{L}/u.test(stripPostcodes(parts[parts.length - 1]!))) parts.pop();

  let countryCode: string | null = null;
  let end = parts.length;
  const last = parts[parts.length - 1] ?? "";
  const lastCode = countryCodeFromName(stripPostcodes(last));
  if (lastCode) {
    countryCode = lastCode;
    end -= 1;
  } else if (/^[A-Z]{2} \d{5}(?:-\d{4})?$/.test(last)) {
    countryCode = "US"; // "New York, NY 10012"
  } else if (/^[A-Z]{2} [A-Z]\d[A-Z] ?\d[A-Z]\d$/.test(last)) {
    countryCode = "CA"; // "Toronto, ON M5H 2M9"
  } else if (parts.length > 1) {
    const firstCode = countryCodeFromName(stripPostcodes(parts[0]!)); // country first: "日本、〒150-0002 東京都…"
    if (firstCode) {
      countryCode = firstCode;
      parts = parts.slice(1);
      end = parts.length;
    }
  }
  if (countryCode && CITY_STATES.has(countryCode)) return { city: canonicalCity(countryName(countryCode)), countryCode };

  const candidates = parts.slice(0, end);
  for (let i = candidates.length - 1; i >= 0; i--) {
    const original = candidates[i]!;
    // India puts the state before the country: "Mumbai, Maharashtra 400001, India"
    if (countryCode === "IN" && i === candidates.length - 1 && candidates.length > 1 && /\b\d{6}\b/.test(original)) continue;
    if (i === 0 && candidates.length > 1 && /\d/.test(original)) continue; // the street line
    const city = canonicalCity(cleanCity(original));
    if (!acceptCity(city) || countryCodeFromName(city)) continue;
    const known = knownCity(city);
    if (candidates.length === 1 && !countryCode && !known) continue; // a lone word may be a venue, not a city
    // "R. Garrett 120, Lisboa" names no country, but Lisbon is in Portugal.
    return { city, countryCode: countryCode ?? known?.countryCode ?? null };
  }
  return { city: null, countryCode };
}

/** "181 Thompson St", "Rua da Rosa 1", "5 Rue de Rivoli": a street line rather than a place's name. */
export function isStreetLine(s: string): boolean {
  const t = s.trim();
  return /\d/.test(t) && (STREET_START.test(t.replace(/^\d+[a-z]?\s+/i, "")) || STREET_END.test(t));
}

// ---------------------------------------------------------------------------
// Signals
// ---------------------------------------------------------------------------

export interface SignalDraft {
  source: SignalSource;
  ref: string;
  kind: SignalKind;
  name: string;
  city?: string | null;
  countryCode?: string | null;
  date?: string | null;
  note?: string | null;
}

/**
 * A complete, already-normalized signal (every field present, null when unknown), or null when
 * there's no usable name. Passing it through TasteSignalSchema changes nothing.
 */
export function makeSignal(d: SignalDraft): TasteSignal | null {
  const name = clip(d.name, 120);
  let ref = cleanText(d.ref).replace(/\s+/g, " ").trim();
  if (!name || !ref) return null;
  if (ref.length > 200) {
    let head = ref.slice(0, 180);
    if (/[\uD800-\uDBFF]$/.test(head)) head = head.slice(0, -1);
    ref = `${head}~${hashString(ref)}`;
  }
  return {
    source: d.source,
    ref,
    kind: d.kind,
    name,
    city: clip(d.city, 80) || null,
    countryCode: asCountryCode(d.countryCode),
    lat: null,
    lng: null,
    date: d.date ? validDay(d.date) : null,
    rating: null,
    liked: null,
    note: clip(d.note, 280) || null,
    url: null,
  };
}
