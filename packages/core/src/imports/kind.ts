import type { SignalKind } from "../taste";
import { fold } from "./text";

/**
 * Guess what kind of place a name is from keywords in many languages, plus category hints
 * (Facebook place categories, Google place types). Hints win over the name;
 * "sight" when nothing matches.
 *
 * Rules run in order and the first match wins: hotel-bar exceptions, then stays, then
 * multi-word phrases ("wine shop", "cooking class", "beer garden") that must beat the single
 * keywords, then single keywords from the most to the least specific kind
 * (nightlife, food, drink, coffee, activity, shop, sight). So "Restaurant & Bar" is food,
 * "Café Museum" is coffee and "Park Hyatt" is a stay.
 */
export function guessKind(name: string, hints: string[] = []): SignalKind {
  for (const hint of hints) {
    if (typeof hint !== "string") continue;
    const k = kindFromHint(hint);
    if (k) return k;
  }
  return matchKind(name) ?? "sight";
}

/** The kind a name's keywords point to, or null when no keyword matches. */
export function matchKind(text: string): SignalKind | null {
  const t = fold(text);
  if (!t) return null;
  for (const [kind, re] of RULES) if (re.test(t)) return kind;
  return null;
}

/** A category or place type: exact category names first, then the same keywords as names. */
function kindFromHint(hint: string): SignalKind | null {
  const t = fold(hint);
  if (!t || NO_KIND_HINT.test(t)) return null;
  for (const [kind, re] of HINT_RULES) if (re.test(t)) return kind;
  return matchKind(hint);
}

type Rule = readonly [SignalKind, RegExp];

// Patterns are written in fold()ed form: lower case, no accents, "&" → "and", punctuation → space.
const prep = (src: string) => src.normalize("NFKD").replace(/[̀-ͯ]/g, "");
/** Whole words or phrases. */
const words = (kind: SignalKind, alts: string): Rule => [kind, new RegExp(`(?:^| )(?:${prep(alts)})(?= |$)`, "u")];
/** Compound words ending in a keyword, as German, Dutch and Nordic languages write them: "Rijksmuseum". */
const endings = (kind: SignalKind, alts: string): Rule => [kind, new RegExp(`\\p{L}(?:${prep(alts)})(?= |$)`, "u")];
/** Scripts written without spaces between words (Japanese, Chinese, Thai) and Korean: substrings. */
const chars = (kind: SignalKind, alts: string): Rule => [kind, new RegExp(prep(alts), "u")];

const STAY =
  "hotels?|hotell|hotelli|otel|oteli|hostels?|hostal|hostales|hosteria|hospedaje|hospedaria|pousadas?|posadas?|paradors?|parador|inns?|ryokan|riads?|" +
  "bnb|b and b|bed and breakfasts?|guest ?houses?|gastehaus|pension|pensione|pensao|albergo|albergue|auberge|agriturismo|masseria|minshuku|" +
  "(?<!ski )resorts?|suites|lodges?|ecolodge|motels?|aparthotel|apart hotel|serviced apartments?|apartments|apartamentos|vacation rentals?|" +
  "holiday (?:rentals?|homes?|lets?)|homestay|boarding house|chambres? d hotes?|camping|campground|campsite|glamping|airbnb|vrbo|club med|" +
  "hyatt|hilton(?! head)|marriott|four seasons|ritz carlton|ritz|mandarin oriental|aman|belmond|sheraton|westin|novotel|ibis|radisson|kimpton|" +
  "rosewood|sofitel|fairmont|intercontinental|shangri la|st regis|waldorf astoria|six senses|one and only|pestana|best western|mercure|andaz|" +
  "citizenm|claridge s|claridges|отель|гостиница|хостел|ξενοδοχειο|فندق|מלון";

const RULES: readonly Rule[] = [
  // A bar in a hotel is a drink, not a stay.
  words("drink", "hotel bar|lobby bar|hotel lounge|lobby lounge"),

  words("stay", STAY),
  endings("stay", "hotel|hotell|hostel"),
  chars("stay", "ホテル|旅館|旅馆|民宿|ゲストハウス|酒店|宾馆|賓館|호텔|게스트하우스|모텔|펜션|โรงแรม|รีสอร์ท"),

  // Phrases that must beat the single keywords further down.
  words(
    "drink",
    "dive bars?|beer gardens?|beer halls?|wine gardens?|beach (?:club|bar)s?|rooftop (?:bar|lounge)s?|tasting rooms?|caves? a vins?|" +
      "bars? a (?:vins?|cocktails?|bieres?)|wine cellars?|bruin cafe|brown cafe|cocktail lounges?",
  ),
  words(
    "food",
    "(?:raw|milk|snack|salad|noodle|oyster|sushi|tapas|ramen|pintxos|pinchos|seafood|burger|taco|poke|dumpling|soup|sandwich) bars?|" +
      "bar and grill|food (?:halls?|markets?|courts?|trucks?|stalls?)|street food|deli bodega|hot pot|fish and chips|supper clubs?|" +
      "tasting menu|steak ?houses?|chop ?houses?|noodle houses?|pancake houses?|dim sum|ice cream",
  ),
  words(
    "coffee",
    "(?:espresso|coffee|juice|smoothie|cafe|caffe|kaffe|kaffee|tea|matcha) bars?|tea (?:houses?|rooms?|salons?|shops?)|salons? de the|" +
      "bubble tea|boba(?: tea)?|coffee (?:houses?|shops?|roasters?|roastery|company|co|lab)|kaffee ?haus",
  ),
  words("nightlife", "live music|music (?:venues?|halls?|clubs?|bars?)|concert (?:halls?|venues?)|comedy (?:clubs?|cellars?)|dance (?:clubs?|halls?)|movie theat(?:er|re)s?|piano bars?"),
  words(
    "activity",
    "(?:cooking|pasta|sushi|baking|bread|cocktail|mixology|wine|coffee|barista|dumpling|ramen|tapas|paella|taco|pastry|chocolate|cheese|pizza|" +
      "gelato|tea|pottery|ceramics|painting|art|dance|tango|salsa|flamenco|surf|yoga|language) (?:making )?(?:class(?:es)?|workshops?|lessons?|courses?|schools?)|" +
      "(?:food|wine|tapas|street food|beer|brewery|pub|bar|coffee|cocktail|whiske?y|sake|mezcal|tequila|market|taco|pintxos|chocolate|cheese) (?:crawls?|tours?|tastings?|walks?)|" +
      "wine tasting|tea ceremony|dive (?:cent(?:er|re)s?|shops?|schools?)|scuba|golf (?:clubs?|courses?|links)|" +
      "(?:country|tennis|yacht|sailing|sports?|padel|squash|rowing|polo) clubs?|(?:theme|amusement|water|adventure|trampoline|safari) parks?|" +
      "escape rooms?|thermal (?:baths?|springs?|spas?)|hot springs?|(?:dance|yoga|pilates|climbing|boxing) (?:studios?|gyms?|schools?|shalas?|walls?)|" +
      "(?:bike|boat|kayak|scooter|surf|ski|paddle ?board|sup) (?:rentals?|hire)|horse(?:back)? riding|day trips?|boat (?:trips?|tours?|rides?)|" +
      "sky ?diving|bungee|hot air balloons?|whale watching|zip ?lines?|jet ?skis?|go ?karts?|ski (?:resorts?|areas?|lifts?)",
  ),
  words(
    "shop",
    "(?:wine|bottle|liquor|book|record|records|vinyl|concept|bike|surf|gift|antiques?|vintage|thrift|second ?hand|souvenir|flower|cheese|" +
      "chocolate|design|furniture|ceramics|pottery|spice|olive oil) (?:shops?|stores?|boutiques?)|department stores?|flea markets?|" +
      "shopping (?:cent(?:er|re)s?|malls?|streets?|arcades?|districts?)|outlet (?:malls?|stores?|village)|galeries lafayette|el corte ingles",
  ),
  words(
    "sight",
    "botanic(?:al)? gardens?|jardin botanique|jardim botanico|jardin botanico|orto botanico|national (?:parks?|monuments?)|city hall|town hall|" +
      "old (?:town|city|quarter)|historic (?:center|centre|district|site|quarter)|opera house|street art|observation (?:deck|tower)|" +
      "scenic (?:lookout|viewpoint|overlook)|sculpture gardens?|hilton head",
  ),

  // Single keywords, most specific kind first.
  words(
    "nightlife",
    "clubs?|nightclubs?|discos?|discotheques?|discotecas?|boates?|jazz|karaoke|cabarets?|burlesque|comedy|theat(?:er|re)s?|teatros?|" +
      "philharmoni[ce]|philharmonie|symphony|ballet|opera|casinos?|cinemas?|nightlife|клуб",
  ),
  chars("nightlife", "ナイトクラブ|夜总会|夜店|클럽"),
  words(
    "food",
    "restaurants?|restaurante|restaurantes|ristorante|ristoranti|restauracja|restaurang|ravintola|etterem|restoran|lokanta|lokantasi|" +
      "trattorias?|trattorie|osterias?|osterie|taquerias?|tacos?|bistros?|bistrot|brasseries?|izakayas?|ramen|sushi|sashimi|omakase|yakitori|" +
      "yakiniku|kaiseki|tempura|tonkatsu|udon|soba|okonomiyaki|pizzas?|pizzerias?|pizzaria|cantinas?|tavernas?|taverne|tavern|tabernas?|tascas?|" +
      "grill|grills|grillroom|kitchens?|cocina|cozinha|cucina|eatery|eateries|diners?|bakery|bakeries|bakehouse|boulangerie|panaderia|padaria|" +
      "panificio|backerei|patisserie|pasticceria|pasteleria|pastelaria|pasteis|konditorei|confeitaria|pastry|pastries|pastane|pastanesi|gelateria|gelato|" +
      "heladeria|steakhouse|steak|churrascaria|asador|parrilla|parrillada|bbq|barbecue|smokehouse|burgers?|deli|delicatessen|creperie|crepes?|" +
      "tapas|pintxos|pinchos|marisqueira|marisqueria|cevicheria|ceviche|seafood|oysters?|noodles?|dumplings?|pho|banh mi|curry|biryani|" +
      "falafel|shawarma|shawerma|kebab|kebap|doner|mezze|meze|gastropub|brunch|breakfast|dine|dining|eats|food|canteen|cantine|fonda|comedor|" +
      "picanteria|polleria|chicken|sandwich(?:es)?|bagels?|donuts?|doughnuts?|cakes?|cupcakes?|desserts?|churreria|churros|warung|dhaba|" +
      "hawker|wirtshaus|imbiss|bouchon|eetcafe|snacks?|salads?|soups?|poke|ресторан|столовая|εστιατοριο|ταβερνα|مطعم|מסעדה",
  ),
  endings("food", "restaurant|ristorante|pizzeria|trattoria|bakery|backerei|konditorei|grill"),
  chars(
    "food",
    "レストラン|食堂|料理|ラーメン|らーめん|寿司|鮨|すし|居酒屋|焼肉|焼き鳥|焼鳥|そば|蕎麦|うどん|天ぷら|とんかつ|お好み焼き|バーガー|ベーカリー|パン屋|" +
      "餐厅|餐廳|面馆|麵館|小吃|火锅|火鍋|烧烤|식당|레스토랑|맛집|ร้านอาหาร|ก๋วยเตี๋ยว",
  ),
  words(
    "drink",
    "bars?|pubs?|wines?|vinos?|vinhos?|wein|vin|vinbar|weinbar|winebar|vineria|vinoteca|vinothek|enotecas?|enoteche|cocktails?|brewery|" +
      "breweries|brewpub|brewing|brouwerij|brauerei|cerveceria|cervejaria|birreria|taprooms?|tap room|tap house|taphouse|beers?|biergarten|" +
      "bierhaus|brauhaus|bierkeller|bierhalle|bodegas?|speakeasy|lounges?|saloon|distillery|winery|wineries|vineyards?|cidery|sake|mezcaleria|" +
      "mezcal|pulqueria|chiringuito|meyhane|kneipe|weinstube|proeflokaal|hospoda|pivnice|whisky|whiskey|gin|rooftop|drinks|бар|паб|пивоварня|μπαρ|بار|בר",
  ),
  endings("drink", "brauhaus|brauerei|bierhaus|bierkeller|biergarten|bierhalle|weinbar|weinstube|brouwerij"),
  chars("drink", "バー|酒吧|酒館|酒馆|ビアホール|ワインバー|와인|칵테일|포차|บาร์|โรงเบียร์"),
  words(
    "coffee",
    "cafes?|caffes?|kafe|kaffe|kaffee|kaffeehaus|kaffebar|koffie|koffiebar|kahve|kahvesi|kahvila|kawiarnia|kavarna|kavezo|kafeneio|" +
      "cafeterias?|cafetaria|coffees?|espresso|roastery|roasters?|kissaten|teahouse|tea|кафе|кофейня|καφε|καφετερια|مقهى|كافيه|كافي|קפה",
  ),
  endings("coffee", "cafe|kaffee|koffie"),
  chars("coffee", "カフェ|喫茶|珈琲|コーヒー|咖啡|카페|커피|คาเฟ่|กาแฟ"),
  words(
    "activity",
    "tours?(?! (?:eiffel|montparnasse|d argent))|excursions?|hikes?|hiking|trails?|treks?|trekking|class|classes|workshops?|lessons?|" +
      "spas?|hammam|hamam|onsen|saunas?|banya|bathhouse|baths|therme|terme|termas|thermal|surf|surfing|dive|diving|snorkel(?:ing|ling)?|" +
      "kayak(?:ing)?|canoe(?:ing)?|rafting|sailing|cruises?|catamaran|climbing|bouldering|yoga|pilates|gym|ski|skiing|snowboard(?:ing)?|" +
      "golf|tennis|padel|cycling|bikes?|biking|safaris?|zipline|paragliding|parasailing|bowling|karting|massages?|stadiums?|estadio|" +
      "stadio|stade|arena|экскурсия|тур|спа|хаммам",
  ),
  endings("activity", "therme|sauna"),
  chars("activity", "ツアー|温泉|体験|教室|ハイキング|サウナ|투어|스파|찜질방|ทัวร์|สปา|นวด"),
  words(
    "shop",
    "shops?|stores?|boutiques?|bookstores?|bookshops?|librairie|libreria|livraria|buchhandlung|boekhandel|markets?|mercados?|marche|" +
      "mercato|markt|markthalle|bazaar|bazar|souks?|souq|flea|malls?|outlets?|emporium|tienda|loja|negozio|jewell?ers?|jewell?ery|jewelry|" +
      "florist|vintage|antiques|fromagerie|epicerie|mercearia|supermarket|магазин|рынок|αγορα|سوق|שוק",
  ),
  endings("shop", "markt"),
  chars("shop", "市場|市场|시장|書店|书店|서점|ショップ|ストア|商店|百貨店|百货|ตลาด|ร้านค้า"),
  words(
    "sight",
    "museums?|museo|musei|musee|museu|muzeum|muzej|museet|galler(?:y|ies)|galleria|gallerie|galerie|galeria|kunsthalle|churche?s?|iglesia|" +
      "igreja|chiesa|eglise|kirche|kerk|kirke|kyrka|kosciol|cathedrals?|catedral|cattedrale|cathedrale|duomo|basilicas?|basilique|chapels?|" +
      "capela|capilla|cappella|mosques?|mezquita|mesquita|moschea|mosquee|camii|masjid|temples?|templo|tempio|wat|ji|dera|jingu|jinja|taisha|" +
      "pagodas?|stupa|shrines?|santuario|sanctuary|synagogues?|sinagoga|monaster(?:y|ies)|mosteiro|monasterio|monastero|abbey|abbaye|abbazia|" +
      "kloster|convento?|palaces?|palacio|palacios|palazzo|palais|palast|paleis|parks?|parque|parco|parc|gardens?|jardin|jardins|jardim|" +
      "giardino|giardini|garten|tuin|beach|beaches|praia|playa|plage|spiaggia|strand|castles?|castillo|castelo|castello|chateau|schloss|" +
      "kasteel|alcazar|alcazaba|monuments?|monumento|memorial|statue|obelisk|landmark|viewpoint|miradouro|mirador|belvedere|lookout|overlook|" +
      "scenic|ruins|ruinas|rovine|ruines|archaeological|acropolis|towers?|torre|turm|bridges?|ponte|puente|pont|brucke|square|plaza|praca|" +
      "piazza|platz|plein|placa|fortress|fort|forte|fortaleza|citadel|citadelle|lighthouse|farol|zoo|aquarium|oceanarium|oceanario|cemetery|" +
      "cementerio|cemiterio|cimetiere|friedhof|cimitero|lakes?|lago|lac|mountains?|mount|mt|monte|volcano|volcan|vulcano|waterfalls?|falls|" +
      "cascada|cachoeira|cascata|canyon|islands?|isla|ilha|isola|ile|bay|cove|cliffs?|caves?|grotto|gruta|cueva|grotta|canal|river|harbou?r|" +
      "marina|pier|promenade|boardwalk|waterfront|fountain|fontana|fuente|neighbou?rhood|barrio|bairro|quartier|medina|kasbah|historic|" +
      "heritage|sculpture|murals?|art|observatory|planetarium|library|biblioteca|bibliotheque|colosseum|coliseum|amphitheat(?:er|re)|aqueduct|" +
      "arc|arch|hills?|forest|bosque|dunes|desert|glacier|lagoon|laguna|valley|valle|gorge|reserve|eiffel|louvre|музей|парк|собор|церковь|" +
      "храм|дворец|площадь|пляж|μουσειο|ναος|εκκλησια|παραλια|καστρο|مسجد|متحف|قلعة|قصر|حديقة|كنيسة|شاطئ|מוזיאון|חוף|פארק",
  ),
  endings("sight", "museum|museet|kirche|kerk|kirke|kyrka|galerie|schloss|turm|platz|plein"),
];

/** Exact category names and Google place types (fold()ed), checked before the name keywords. */
const HINT_RULES: readonly Rule[] = [
  [
    "city",
    /^(?:locality|sublocality(?: level \d)?|postal town|cit(?:y|ies)|towns?|villages?|municipalit(?:y|ies)|capital(?: city)?|countr(?:y|ies)|states?|provinces?|regions?|count(?:y|ies)|administrative area(?: level \d)?|colloquial area|political|islands?|archipelago)$/,
  ],
  ["stay", /^(?:lodging|campground|rv park|accommodations?)$/],
  ["food", /^(?:meal takeaway|meal delivery)$/],
  ["sight", /^(?:tourist attraction|natural feature|place of worship|historical landmark)$/],
  ["activity", /^(?:gym|bowling alley|travel agency)$/],
  ["shop", /^(?:grocery or supermarket|grocery store|convenience store)$/],
  ["nightlife", /^(?:night club|movie theater)$/],
];

/** Generic types that say nothing about the kind: skip them and look at the next hint. */
const NO_KIND_HINT = /^(?:point of interest|establishment|premise|street address|route|food and drink|travel and transport|professional and other places|residence|other)$/;
