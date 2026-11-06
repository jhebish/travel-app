import { fold } from "./text";

/**
 * Reference data for turning airports and city names into cities: ~200 of the world's busiest
 * and most-visited airports (IATA code → city, country), metro codes, well-known airport
 * names, extra destinations without a major airport, and local city names → the English name
 * the rest of Pylos uses ("Lisboa" → "Lisbon").
 */

export interface CityRef {
  city: string;
  countryCode: string;
}

const AIRPORTS: readonly string[] = [
  // United States and Canada
  "ATL:Atlanta:US", "LAX:Los Angeles:US", "BUR:Los Angeles:US", "LGB:Long Beach:US", "SNA:Orange County:US", "ORD:Chicago:US", "MDW:Chicago:US",
  "DFW:Dallas:US", "DAL:Dallas:US", "DEN:Denver:US", "JFK:New York:US", "LGA:New York:US", "EWR:New York:US", "SFO:San Francisco:US",
  "OAK:Oakland:US", "SJC:San Jose:US", "SEA:Seattle:US", "LAS:Las Vegas:US", "MCO:Orlando:US", "MIA:Miami:US", "FLL:Fort Lauderdale:US",
  "CLT:Charlotte:US", "PHX:Phoenix:US", "IAH:Houston:US", "HOU:Houston:US", "BOS:Boston:US", "MSP:Minneapolis:US", "DTW:Detroit:US",
  "PHL:Philadelphia:US", "BWI:Baltimore:US", "IAD:Washington:US", "DCA:Washington:US", "SLC:Salt Lake City:US", "SAN:San Diego:US",
  "TPA:Tampa:US", "PDX:Portland:US", "HNL:Honolulu:US", "OGG:Maui:US", "AUS:Austin:US", "BNA:Nashville:US", "MSY:New Orleans:US",
  "STL:St. Louis:US", "RDU:Raleigh:US", "SMF:Sacramento:US", "ANC:Anchorage:US", "SJU:San Juan:PR",
  "YYZ:Toronto:CA", "YVR:Vancouver:CA", "YUL:Montreal:CA", "YYC:Calgary:CA", "YOW:Ottawa:CA",
  // Mexico, Central America, Caribbean
  "MEX:Mexico City:MX", "CUN:Cancún:MX", "GDL:Guadalajara:MX", "SJD:Los Cabos:MX", "PVR:Puerto Vallarta:MX", "OAX:Oaxaca:MX",
  "MTY:Monterrey:MX", "TQO:Tulum:MX", "MID:Mérida:MX", "PUJ:Punta Cana:DO", "SDQ:Santo Domingo:DO", "NAS:Nassau:BS", "MBJ:Montego Bay:JM",
  "KIN:Kingston:JM", "HAV:Havana:CU", "SJO:San José:CR", "LIR:Guanacaste:CR", "PTY:Panama City:PA", "AUA:Aruba:AW", "BGI:Barbados:BB",
  "SXM:St. Maarten:SX", "GCM:Grand Cayman:KY",
  // South America
  "GRU:São Paulo:BR", "CGH:São Paulo:BR", "GIG:Rio de Janeiro:BR", "SDU:Rio de Janeiro:BR", "BSB:Brasília:BR", "EZE:Buenos Aires:AR",
  "AEP:Buenos Aires:AR", "SCL:Santiago:CL", "LIM:Lima:PE", "CUZ:Cusco:PE", "BOG:Bogotá:CO", "MDE:Medellín:CO", "CTG:Cartagena:CO",
  "UIO:Quito:EC", "GYE:Guayaquil:EC", "MVD:Montevideo:UY",
  // Europe
  "LHR:London:GB", "LGW:London:GB", "STN:London:GB", "LTN:London:GB", "LCY:London:GB", "MAN:Manchester:GB", "EDI:Edinburgh:GB",
  "DUB:Dublin:IE", "CDG:Paris:FR", "ORY:Paris:FR", "NCE:Nice:FR", "LYS:Lyon:FR", "MRS:Marseille:FR", "AMS:Amsterdam:NL",
  "FRA:Frankfurt:DE", "MUC:Munich:DE", "BER:Berlin:DE", "HAM:Hamburg:DE", "DUS:Düsseldorf:DE", "MAD:Madrid:ES", "BCN:Barcelona:ES",
  "PMI:Palma de Mallorca:ES", "AGP:Málaga:ES", "SVQ:Seville:ES", "IBZ:Ibiza:ES", "VLC:Valencia:ES", "BIO:Bilbao:ES", "LIS:Lisbon:PT",
  "OPO:Porto:PT", "FAO:Faro:PT", "FNC:Funchal:PT", "FCO:Rome:IT", "CIA:Rome:IT", "MXP:Milan:IT", "LIN:Milan:IT", "BGY:Milan:IT",
  "VCE:Venice:IT", "NAP:Naples:IT", "FLR:Florence:IT", "PSA:Pisa:IT", "BLQ:Bologna:IT", "CTA:Catania:IT", "PMO:Palermo:IT",
  "OLB:Olbia:IT", "CAG:Cagliari:IT", "BRI:Bari:IT", "ZRH:Zurich:CH", "GVA:Geneva:CH", "VIE:Vienna:AT", "BRU:Brussels:BE",
  "CPH:Copenhagen:DK", "ARN:Stockholm:SE", "OSL:Oslo:NO", "HEL:Helsinki:FI", "KEF:Reykjavík:IS", "PRG:Prague:CZ", "BUD:Budapest:HU",
  "WAW:Warsaw:PL", "KRK:Kraków:PL", "ATH:Athens:GR", "JTR:Santorini:GR", "JMK:Mykonos:GR", "HER:Heraklion:GR", "CFU:Corfu:GR",
  "RHO:Rhodes:GR", "IST:Istanbul:TR", "SAW:Istanbul:TR", "AYT:Antalya:TR", "DBV:Dubrovnik:HR", "SPU:Split:HR", "ZAG:Zagreb:HR",
  "OTP:Bucharest:RO", "SOF:Sofia:BG", "BEG:Belgrade:RS", "TLL:Tallinn:EE", "RIX:Riga:LV", "VNO:Vilnius:LT", "MLA:Valletta:MT",
  "LCA:Larnaca:CY", "SVO:Moscow:RU", "LED:Saint Petersburg:RU", "KBP:Kyiv:UA", "TBS:Tbilisi:GE", "EVN:Yerevan:AM", "GYD:Baku:AZ",
  // Middle East and Africa
  "DXB:Dubai:AE", "DWC:Dubai:AE", "AUH:Abu Dhabi:AE", "DOH:Doha:QA", "RUH:Riyadh:SA", "JED:Jeddah:SA", "AMM:Amman:JO", "TLV:Tel Aviv:IL",
  "BEY:Beirut:LB", "BAH:Manama:BH", "MCT:Muscat:OM", "KWI:Kuwait City:KW", "CAI:Cairo:EG", "SSH:Sharm El Sheikh:EG", "HRG:Hurghada:EG",
  "LXR:Luxor:EG", "RAK:Marrakech:MA", "CMN:Casablanca:MA", "FEZ:Fez:MA", "TUN:Tunis:TN", "JNB:Johannesburg:ZA", "CPT:Cape Town:ZA",
  "DUR:Durban:ZA", "NBO:Nairobi:KE", "ADD:Addis Ababa:ET", "LOS:Lagos:NG", "ACC:Accra:GH", "DAR:Dar es Salaam:TZ", "ZNZ:Zanzibar:TZ",
  "JRO:Arusha:TZ", "KGL:Kigali:RW", "MRU:Mauritius:MU", "SEZ:Seychelles:SC",
  // Asia and Oceania
  "HND:Tokyo:JP", "NRT:Tokyo:JP", "KIX:Osaka:JP", "ITM:Osaka:JP", "NGO:Nagoya:JP", "CTS:Sapporo:JP", "FUK:Fukuoka:JP", "OKA:Okinawa:JP",
  "ICN:Seoul:KR", "GMP:Seoul:KR", "PUS:Busan:KR", "CJU:Jeju:KR", "PEK:Beijing:CN", "PKX:Beijing:CN", "PVG:Shanghai:CN", "SHA:Shanghai:CN",
  "CAN:Guangzhou:CN", "SZX:Shenzhen:CN", "CTU:Chengdu:CN", "TFU:Chengdu:CN", "HKG:Hong Kong:HK", "MFM:Macau:MO", "TPE:Taipei:TW",
  "TSA:Taipei:TW", "SIN:Singapore:SG", "BKK:Bangkok:TH", "DMK:Bangkok:TH", "HKT:Phuket:TH", "CNX:Chiang Mai:TH", "USM:Koh Samui:TH",
  "KUL:Kuala Lumpur:MY", "PEN:Penang:MY", "CGK:Jakarta:ID", "DPS:Bali:ID", "MNL:Manila:PH", "CEB:Cebu:PH", "SGN:Ho Chi Minh City:VN",
  "HAN:Hanoi:VN", "DAD:Da Nang:VN", "PNH:Phnom Penh:KH", "REP:Siem Reap:KH", "SAI:Siem Reap:KH", "RGN:Yangon:MM", "DEL:Delhi:IN",
  "BOM:Mumbai:IN", "BLR:Bengaluru:IN", "MAA:Chennai:IN", "HYD:Hyderabad:IN", "CCU:Kolkata:IN", "GOI:Goa:IN", "GOX:Goa:IN", "COK:Kochi:IN",
  "JAI:Jaipur:IN", "CMB:Colombo:LK", "MLE:Maldives:MV", "KTM:Kathmandu:NP", "DAC:Dhaka:BD", "KHI:Karachi:PK", "LHE:Lahore:PK",
  "ISB:Islamabad:PK", "TAS:Tashkent:UZ", "ALA:Almaty:KZ", "SYD:Sydney:AU", "MEL:Melbourne:AU", "BNE:Brisbane:AU", "PER:Perth:AU",
  "ADL:Adelaide:AU", "OOL:Gold Coast:AU", "CNS:Cairns:AU", "AKL:Auckland:NZ", "WLG:Wellington:NZ", "CHC:Christchurch:NZ",
  "ZQN:Queenstown:NZ", "NAN:Fiji:FJ", "PPT:Tahiti:PF",
  // Metro-area codes used by airlines and travel sites
  "NYC:New York:US", "CHI:Chicago:US", "WAS:Washington:US", "YTO:Toronto:CA", "YMQ:Montreal:CA", "LON:London:GB", "PAR:Paris:FR",
  "MIL:Milan:IT", "ROM:Rome:IT", "STO:Stockholm:SE", "MOW:Moscow:RU", "BUE:Buenos Aires:AR", "SAO:São Paulo:BR", "RIO:Rio de Janeiro:BR",
  "TYO:Tokyo:JP", "OSA:Osaka:JP", "SEL:Seoul:KR", "BJS:Beijing:CN",
];

/** Airport names people type instead of the city ("Heathrow", "JFK Terminal 4"). */
const AIRPORT_NAMES: Record<string, string> = {
  heathrow: "LHR", gatwick: "LGW", stansted: "STN", "charles de gaulle": "CDG", orly: "ORY", schiphol: "AMS", fiumicino: "FCO",
  malpensa: "MXP", linate: "LIN", barajas: "MAD", "el prat": "BCN", "humberto delgado": "LIS", portela: "LIS", narita: "NRT",
  haneda: "HND", changi: "SIN", incheon: "ICN", "o hare": "ORD", ohare: "ORD", logan: "BOS", dulles: "IAD", "john f kennedy": "JFK",
  "la guardia": "LGA", laguardia: "LGA", newark: "EWR", pearson: "YYZ", suvarnabhumi: "BKK", "don mueang": "DMK", "sabiha gokcen": "SAW",
  "ben gurion": "TLV", kastrup: "CPH", arlanda: "ARN", gardermoen: "OSL", keflavik: "KEF", "marco polo": "VCE", capodichino: "NAP",
  "el dorado": "BOG", "jorge chavez": "LIM", ezeiza: "EZE", guarulhos: "GRU", galeao: "GIG", "benito juarez": "MEX",
  "kingsford smith": "SYD", tullamarine: "MEL",
};

/** Popular destinations without a major airport of their own. */
const EXTRA_CITIES: readonly string[] = [
  "Kyoto:JP", "Nara:JP", "Hakone:JP", "Kanazawa:JP", "Hiroshima:JP", "Sintra:PT", "Cascais:PT", "Comporta:PT", "Évora:PT", "Amalfi:IT",
  "Positano:IT", "Capri:IT", "Siena:IT", "Como:IT", "Verona:IT", "Lucca:IT", "Cinque Terre:IT", "Granada:ES", "San Sebastián:ES",
  "Toledo:ES", "Bruges:BE", "Ghent:BE", "Salzburg:AT", "Hallstatt:AT", "Innsbruck:AT", "Interlaken:CH", "Zermatt:CH", "Lucerne:CH",
  "Oxford:GB", "Bath:GB", "Kotor:ME", "Hvar:HR", "Cappadocia:TR", "Bodrum:TR", "Petra:JO", "Agra:IN", "Udaipur:IN", "Varanasi:IN",
  "Luang Prabang:LA", "Hoi An:VN", "Ubud:ID", "Chefchaouen:MA", "Essaouira:MA", "Napa:US", "Sonoma:US", "Malibu:US", "Santa Barbara:US",
  "Palm Springs:US", "Aspen:US", "Big Sur:US", "Carmel:US", "Miami Beach:US", "Key West:US", "Savannah:US", "Charleston:US", "Sedona:US",
  "Brooklyn:US", "San Miguel de Allende:MX", "Playa del Carmen:MX", "Mendoza:AR", "Bariloche:AR", "Valparaíso:CL", "Stellenbosch:ZA",
  "Franschhoek:ZA", "Monaco:MC", "Gibraltar:GI", "Vatican City:VA",
];

/** Local or alternative names → the English name used across Pylos. Keys are written naturally and folded at load. */
const CITY_ALIASES: Record<string, string> = {
  Lisboa: "Lisbon", Lisbonne: "Lisbon", Lissabon: "Lisbon", Milano: "Milan", Mailand: "Milan", Roma: "Rome", Firenze: "Florence",
  Venezia: "Venice", Napoli: "Naples", Torino: "Turin", Genova: "Genoa", Praha: "Prague", Prag: "Prague", Wien: "Vienna",
  München: "Munich", Köln: "Cologne", Nürnberg: "Nuremberg", København: "Copenhagen", "Den Haag": "The Hague", "'s-Gravenhage": "The Hague",
  Bruxelles: "Brussels", Brussel: "Brussels", Antwerpen: "Antwerp", Genève: "Geneva", Genf: "Geneva", Zürich: "Zurich", Luzern: "Lucerne",
  Sevilla: "Seville", "Ciudad de México": "Mexico City", CDMX: "Mexico City", "México D.F.": "Mexico City", "Oaxaca de Juárez": "Oaxaca",
  Athina: "Athens", Athína: "Athens", Αθήνα: "Athens", İstanbul: "Istanbul", Moskva: "Moscow", Москва: "Moscow",
  "Sankt-Peterburg": "Saint Petersburg", "St Petersburg": "Saint Petersburg", "St. Petersburg": "Saint Petersburg", "Санкт-Петербург": "Saint Petersburg",
  Warszawa: "Warsaw", Krakow: "Kraków", București: "Bucharest", Beograd: "Belgrade", Kiev: "Kyiv", "Al Qahirah": "Cairo", القاهرة: "Cairo",
  Marrakesh: "Marrakech", Fès: "Fez", Beyrouth: "Beirut", بيروت: "Beirut", 東京: "Tokyo", 東京都: "Tokyo", 京都: "Kyoto", 京都市: "Kyoto",
  大阪: "Osaka", 大阪市: "Osaka", 서울: "Seoul", 北京: "Beijing", 上海: "Shanghai", 香港: "Hong Kong", 台北: "Taipei", 臺北: "Taipei",
  "Thành phố Hồ Chí Minh": "Ho Chi Minh City", "Ho Chi Minh": "Ho Chi Minh City", Saigon: "Ho Chi Minh City", "New York City": "New York",
  NYC: "New York", Bombay: "Mumbai", Bangalore: "Bengaluru", Calcutta: "Kolkata", Madras: "Chennai", "Krung Thep Maha Nakhon": "Bangkok",
  กรุงเทพมหานคร: "Bangkok", "Washington DC": "Washington", "Washington D.C.": "Washington", CABA: "Buenos Aires",
  "Ciudad Autónoma de Buenos Aires": "Buenos Aires", Donostia: "San Sebastián", Palma: "Palma de Mallorca", Macao: "Macau", Hongkong: "Hong Kong",
};

const US_STATES =
  "Alabama|Alaska|Arizona|Arkansas|California|Colorado|Connecticut|Delaware|Florida|Georgia|Hawaii|Idaho|Illinois|Indiana|Iowa|Kansas|" +
  "Kentucky|Louisiana|Maine|Maryland|Massachusetts|Michigan|Minnesota|Mississippi|Missouri|Montana|Nebraska|Nevada|New Hampshire|" +
  "New Jersey|New Mexico|New York|North Carolina|North Dakota|Ohio|Oklahoma|Oregon|Pennsylvania|Rhode Island|South Carolina|" +
  "South Dakota|Tennessee|Texas|Utah|Vermont|Virginia|Washington|West Virginia|Wisconsin|Wyoming|District of Columbia";
const US_STATE_NAMES = new Map(US_STATES.split("|").map((s) => [fold(s), s]));
/** "hawaii" → "Hawaii": a US state's name as written, else null. */
export const usStateName = (name: string): string | null => US_STATE_NAMES.get(fold(name)) ?? null;

const BY_CODE = new Map<string, CityRef>();
const BY_NAME = new Map<string, CityRef>();
for (const row of AIRPORTS) {
  const [code, city, countryCode] = row.split(":") as [string, string, string];
  const ref = { city, countryCode };
  BY_CODE.set(code, ref);
  // First entry wins, so "San Jose" stays in California and "San José" (SJO) is only reached by code.
  if (!BY_NAME.has(fold(city))) BY_NAME.set(fold(city), ref);
}
for (const row of EXTRA_CITIES) {
  const [city, countryCode] = row.split(":") as [string, string];
  if (!BY_NAME.has(fold(city))) BY_NAME.set(fold(city), { city, countryCode });
}
const ALIASES = new Map(Object.entries(CITY_ALIASES).map(([k, v]) => [fold(k), v]));
const AIRPORT_NAME_RE = new RegExp(`(?:^| )(${Object.keys(AIRPORT_NAMES).join("|")})(?= |$)`);

/** "LIS" → Lisbon, PT. Upper-case three-letter codes only. */
export const airportByCode = (code: string): CityRef | null => (/^[A-Z]{3}$/.test(code) ? BY_CODE.get(code) ?? null : null);

/** "London Heathrow" or "Aeroporto Humberto Delgado" → that airport's city. */
export function airportByName(text: string): CityRef | null {
  const m = fold(text).match(AIRPORT_NAME_RE);
  const code = m ? AIRPORT_NAMES[m[1]!] : undefined;
  return code ? BY_CODE.get(code) ?? null : null;
}

/** The English name for a city when we know one ("Lisboa" → "Lisbon", "LISBON" → "Lisbon"), else the input trimmed. */
export function canonicalCity(name: string): string {
  const key = fold(name);
  return ALIASES.get(key) ?? BY_NAME.get(key)?.city ?? name.replace(/\s+/g, " ").trim();
}

/** A city we know by name, with its country. */
export function knownCity(name: string): CityRef | null {
  if (!name.trim()) return null;
  return BY_NAME.get(fold(canonicalCity(name))) ?? null;
}
