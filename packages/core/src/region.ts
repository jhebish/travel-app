import { countryCodeFor } from "./countries";
import { fold } from "./imports/text";

/**
 * Where Pylos plans trips (an owner's decision, applied everywhere a trip or a stop is planned):
 * - Not in Israel. Asking for a trip to any city there sends the traveler to BLOCKED_REDIRECT.
 * - Jerusalem and the West Bank are planned. In Jerusalem, only with Palestinian businesses and
 *   experiences (JERUSALEM_RULES, the searches in placesQueries, and inEastJerusalem).
 */
export const BLOCKED_REDIRECT = "https://www.youtube.com/watch?v=jF6N2OKo8rk&list=RDjF6N2OKo8rk&start_radio=1";

export type RegionPolicy = "ok" | "blocked" | "jerusalem";

/** Jerusalem: a carve-out. */
const JERUSALEM = ["jerusalem", "east jerusalem", "al quds", "alquds", "quds", "yerushalayim", "ירושלים", "القدس", "اورشليم", "أورشليم"];

/** The West Bank: a carve-out. */
const WEST_BANK = [
  "west bank", "palestine", "palestinian territories", "palestinian territory", "occupied palestinian territories",
  "bethlehem", "beit sahour", "beit jala", "ramallah", "al bireh", "el bireh", "nablus", "hebron", "al khalil", "jericho", "ariha",
  "jenin", "tulkarm", "tulkarem", "qalqilya", "qalqiliya", "salfit", "tubas", "birzeit", "taybeh", "taibeh", "sebastia", "sebastiya",
  "battir", "jifna", "wadi qelt", "mar saba", "nabi musa",
  "فلسطين", "الضفة الغربية", "بيت لحم", "رام الله", "نابلس", "الخليل", "أريحا", "اريحا", "جنين", "طولكرم", "قلقيلية", "سلفيت", "بيرزيت", "سبسطية", "بتير",
];

/** Cities and areas in Israel. (Not "Acre" or "Arad": a Brazilian state and a Romanian city share those names.) */
const ISRAEL_PLACES = [
  "tel aviv", "tel aviv yafo", "jaffa", "yafo", "haifa", "eilat", "nazareth", "tiberias", "akko", "acco", "caesarea", "herzliya",
  "netanya", "beersheba", "beer sheva", "be er sheva", "beer sheba", "ashdod", "ashkelon", "ramat gan", "rishon lezion", "rishon le zion",
  "petah tikva", "petach tikva", "holon", "bat yam", "rehovot", "nahariya", "safed", "tzfat", "zefat", "ein gedi", "ein bokek", "masada",
  "mitzpe ramon", "negev", "galilee", "sea of galilee", "golan", "golan heights", "zichron yaakov", "zikhron yaakov", "rosh pina", "rosh pinna",
  "modiin", "kfar saba", "raanana", "hod hasharon", "dimona", "kiryat shmona", "metula", "karmiel", "afula", "beit shean", "timna", "rosh hanikra",
  "תל אביב", "יפו", "חיפה", "אילת", "נצרת", "טבריה", "עכו", "צפת", "נתניה", "הרצליה", "באר שבע",
  "تل أبيب", "تل ابيب", "حيفا", "يافا", "الناصرة", "عكا", "طبريا", "إيلات", "ايلات", "بئر السبع",
];
const ISRAEL = ["israel", "ישראל", "إسرائيل", "اسرائيل"];

/** Jerusalem streets and gates named after Jaffa: in Jerusalem, not Jaffa. */
const JERUSALEM_LANDMARKS = ["jaffa gate", "jaffa road", "jaffa street"];

/** US states (and the country itself): "Nazareth, Pennsylvania" is not the Nazareth in Israel. */
const US_STATES = new Set([
  "alabama", "alaska", "arizona", "arkansas", "california", "colorado", "connecticut", "delaware", "florida", "georgia", "hawaii", "idaho",
  "illinois", "indiana", "iowa", "kansas", "kentucky", "louisiana", "maine", "maryland", "massachusetts", "michigan", "minnesota",
  "mississippi", "missouri", "montana", "nebraska", "nevada", "new hampshire", "new jersey", "new mexico", "new york", "north carolina",
  "north dakota", "ohio", "oklahoma", "oregon", "pennsylvania", "rhode island", "south carolina", "south dakota", "tennessee", "texas",
  "utah", "vermont", "virginia", "washington", "west virginia", "wisconsin", "wyoming", "usa", "united states", "us",
]);

const pad = (s: string) => ` ${fold(s)} `;
const FOLDED = (names: readonly string[]) => names.map(pad);
const J = FOLDED(JERUSALEM);
const W = FOLDED(WEST_BANK);
const P = FOLDED(ISRAEL_PLACES);
const I = FOLDED(ISRAEL);
const has = (text: string, names: readonly string[]) => names.some((n) => text.includes(n));

/**
 * The policy for a destination as typed ("Haifa", "Jerusalem, Israel", "Nazareth, Pennsylvania").
 * A city in Israel, or Israel itself, is "blocked"; Jerusalem is "jerusalem"; the West Bank and
 * everywhere else, "ok". A place named after a different country or US state is elsewhere.
 */
export function regionPolicy(destination: string): RegionPolicy {
  let text = pad(destination);
  for (const l of JERUSALEM_LANDMARKS) text = text.replaceAll(` ${l} `, " jerusalem ");
  const after = destination.split(",").slice(1).map((p) => p.trim()).filter(Boolean);
  const elsewhere = after.some((p) => {
    const cc = countryCodeFor(p);
    return (cc !== null && cc !== "IL" && cc !== "PS") || US_STATES.has(fold(p));
  });
  if (elsewhere && !has(text, I)) return "ok";
  if (has(text, P) || (text.includes(" dead sea ") && !text.includes(" jordan "))) return "blocked";
  if (has(text, J)) return "jerusalem";
  if (has(text, W)) return "ok";
  if (has(text, I)) return "blocked";
  return "ok";
}

/** The planner's rules for Jerusalem trips (added to every prompt for one). */
export const JERUSALEM_RULES = `JERUSALEM
- Only Palestinian-owned and Palestinian-run businesses and Palestinian experiences: restaurants, cafés, bakeries, hotels, shops, guides and cultural centers in East Jerusalem and the Old City (Salah al-Din Street, Sheikh Jarrah, Wadi al-Joz, the souks inside Damascus Gate).
- Holy sites and landmarks of every faith are fine to visit (Al-Aqsa and the Dome of the Rock, the Church of the Holy Sepulchre, the Old City walls), with a Palestinian guide or angle where you can.
- No businesses in West Jerusalem or the Israeli settlements, and no Israeli-run venues or tours.`;

/** West of this line (roughly the 1949 armistice line through the city) is West Jerusalem. */
const EAST_JERUSALEM_MIN_LNG = 35.2255;

/** For Jerusalem trips: whether a place Google found is in East Jerusalem or the Old City. Places without coordinates are kept. */
export const inEastJerusalem = (c: { verification?: { lng?: number } | null }) => c.verification?.lng == null || c.verification.lng >= EAST_JERUSALEM_MIN_LNG;
