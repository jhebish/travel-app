import { describe, expect, it } from "vitest";
import {
  AskCreateSchema,
  AskReplySchema,
  DaySchema,
  HotelSchema,
  SOURCES,
  SOURCE_BY_ID,
  StopSchema,
  TripRequestSchema,
  askPlacesFrom,
  askQuestion,
  blendWeights,
  candidateRole,
  creditSummary,
  defaultWeights,
  friendBadge,
  friendBonus,
  friendCandidateId,
  friendCandidates,
  friendPickLabel,
  isFutureDay,
  isFutureTrip,
  isLocalFor,
  isLoved,
  localExpertCities,
  lovedRankThreshold,
  matchFriendCandidate,
  publicItinerary,
  scoreCandidate,
  selectCandidates,
  tripWhen,
  withFriendCandidates,
  type Candidate,
  type FriendCredit,
  type Itinerary,
} from "../src";

const NOW = new Date("2026-11-07T12:00:00Z");
const sara: FriendCredit = { userId: "u-sara", name: "Sara Haddad", local: true, from: "loved" };
const omar: FriendCredit = { userId: "u-omar", name: "Omar Aziz", local: false, from: "loved" };

const req = TripRequestSchema.parse({ destination: "Lisbon", days: 2, party: "Couple", budget: "Mid-range", pace: "Balanced", interests: ["Food"] });

describe("the friends source", () => {
  it("is in the source list with weight 9, and blends in when saved settings predate it", () => {
    expect(SOURCE_BY_ID.friends).toMatchObject({ name: "Friends who've been", defaultWeight: 9 });
    expect(SOURCES.map((s) => s.id)).toContain("friends");
    // Curators' weights saved before friends existed: friends gets its default.
    const { friends: _f, ...old } = defaultWeights();
    expect(blendWeights({ weights: old, blocked: ["sponsored"] }).weights.friends).toBe(9);
    // A traveler can turn it down or off like any source.
    expect(blendWeights({ weights: old, blocked: [] }, { useCustom: true, weights: { friends: 2 }, blocked: [] }).weights.friends).toBe(2);
    expect(blendWeights({ weights: old, blocked: [] }, { useCustom: true, weights: {}, blocked: ["friends"] }).weights.friends).toBe(0);
  });

  it("maps the model's loose labels onto it, without taking 'Local friends' from locals", () => {
    const day = DaySchema.parse({ label: "Day 1", theme: "", stops: [{ name: "A", source: "Friends who've been" }, { name: "B", source: "friends" }, { name: "C", source: "Local friends" }] });
    expect(day.stops.map((s) => s.source)).toEqual(["friends", "friends", "locals"]);
  });

  it("keeps a pick's friend on stops and hotels, and drops a malformed one rather than the stop", () => {
    expect(StopSchema.parse({ name: "A", source: "friends", origin: "friend", friend: { name: "Sara", local: true } }).friend).toEqual({ name: "Sara", local: true });
    expect(HotelSchema.parse({ name: "H", source: "friends", friend: { name: "Omar", more: 2 } }).friend).toEqual({ name: "Omar", more: 2 });
    const bad = StopSchema.parse({ name: "A", source: "friends", friend: { name: "" } });
    expect(bad.name).toBe("A");
    expect(bad.friend).toBeUndefined();
  });

  it("never shows whose pick it was to anyone else", () => {
    const it0: Itinerary = {
      title: "T",
      summary: "",
      notes: [],
      replaced: [],
      days: [{ label: "Day 1", theme: "", stops: [{ time: "", name: "A", neighborhood: "", why: "", localTip: "", source: "friends", origin: "friend", friend: { name: "Sara", local: true } }] }],
      hotels: [{ name: "H", neighborhood: "", style: "", nightly: "", why: "", localTip: "", source: "friends", friend: { name: "Omar" } }],
    };
    const pub = publicItinerary(it0);
    expect(pub.days[0]!.stops[0]).not.toHaveProperty("friend");
    expect(pub.hotels[0]).not.toHaveProperty("friend");
    expect(pub.days[0]!.stops[0]!.source).toBe("friends");
  });
});

describe("dates", () => {
  it("knows a past trip or a visit that hasn't happened yet", () => {
    expect(isFutureTrip({ year: 2027 }, NOW)).toBe(true);
    expect(isFutureTrip({ year: 2026, month: 12 }, NOW)).toBe(true);
    // This month may still be ahead: it counts once the month has ended.
    expect(isFutureTrip({ year: 2026, month: 11 }, NOW)).toBe(true);
    expect(isFutureTrip({ year: 2026, month: 10 }, NOW)).toBe(false);
    expect(isFutureTrip({ year: 2026 }, NOW)).toBe(false);
    expect(isFutureTrip({ year: null }, NOW)).toBe(false);
    expect(isFutureDay("2026-11-08", NOW)).toBe(true);
    expect(isFutureDay("2026-11-07", NOW)).toBe(false);
    expect(isFutureDay(null, NOW)).toBe(false);
  });
  it("says when, unless the owner hides dates", () => {
    expect(tripWhen({ year: 2024, month: 5 })).toBe("May 2024");
    expect(tripWhen({ year: 2024 })).toBe("2024");
    expect(tripWhen({ year: 2024, month: 5, hideDates: true })).toBeNull();
    expect(tripWhen({ year: null })).toBeNull();
  });
});

describe("local experts", () => {
  const trips = (city: string, n: number, year = 2023) => Array.from({ length: n }, (_, i) => ({ city, year: year - i, month: 4 }));

  it("is a local in their home city", () => {
    expect(isLocalFor("Lisbon", { homeCity: "Lisbon, Portugal", trips: [] }, NOW)).toBe(true);
    expect(isLocalFor("lisboa", { homeCity: "Lisbon", trips: [] }, NOW)).toBe(false);
    expect(isLocalFor("São Paulo", { homeCity: "Sao Paulo", trips: [] }, NOW)).toBe(true);
  });

  it("is a local after three past trips, not two, and trips in the future don't count", () => {
    expect(isLocalFor("Porto", { trips: trips("Porto", 3) }, NOW)).toBe(true);
    expect(isLocalFor("Porto", { trips: trips("Porto", 2) }, NOW)).toBe(false);
    expect(isLocalFor("Porto", { trips: [...trips("Porto", 2), { city: "Porto", year: 2027, month: 3 }] }, NOW)).toBe(false);
    expect(isLocalFor("Porto, Portugal", { trips: [{ city: "porto", year: 2020 }, { city: "Porto", year: 2021 }, { city: "PORTO", year: null }] }, NOW)).toBe(true);
  });

  it("lists home first, then the cities they keep going back to", () => {
    const list = localExpertCities({ homeCity: "Beirut", trips: [...trips("Paris", 3), ...trips("Lisbon", 4), ...trips("Beirut", 5), ...trips("Rome", 1)] }, NOW);
    expect(list.map((c) => c.label)).toEqual(["Beirut", "Lisbon", "Paris"]);
    expect(localExpertCities({ homeCity: "", trips: [] }, NOW)).toEqual([]);
  });
});

describe("loved places", () => {
  it("counts likes, 4 and 5 stars, and the top third of their own ranking", () => {
    const bar = lovedRankThreshold([10, 30, 20, 50, 40, 60]);
    expect(bar).toBe(50);
    expect(isLoved({ liked: true }, null)).toBe(true);
    expect(isLoved({ rating: 4 }, null)).toBe(true);
    expect(isLoved({ rating: 3 }, null)).toBe(false);
    expect(isLoved({ rankScore: 55 }, bar)).toBe(true);
    expect(isLoved({ rankScore: 45 }, bar)).toBe(false);
    expect(isLoved({ rankScore: 99 }, null)).toBe(false);
  });
  it("never counts a place they didn't like, whatever its rank", () => {
    expect(isLoved({ liked: false, rating: 5, rankScore: 99 }, 10)).toBe(false);
    expect(isLoved({ rating: 2, rankScore: 99 }, 10)).toBe(false);
  });
  it("needs three ranked places before the ranking says anything", () => {
    expect(lovedRankThreshold([1, 2])).toBeNull();
    expect(lovedRankThreshold([null, undefined, 3])).toBeNull();
    expect(lovedRankThreshold([1, 2, 3])).toBe(3);
  });
});

describe("friends' places as candidates", () => {
  const places = [
    { credit: omar, name: "Taberna da Rua das Flores", kind: "food" as const, note: "Get the petiscos" },
    { credit: sara, name: "Taberna Da Rua Das Flores", kind: "food" as const },
    { credit: sara, name: "Café da Garagem", kind: "coffee" as const },
    { credit: sara, name: "Lisbon", kind: "city" as const },
    { credit: { ...omar, from: "ask" as const }, name: "Memmo Alfama", kind: "stay" as const },
    { credit: sara, name: "  ", kind: "sight" as const },
  ];

  it("makes one candidate per place, credits everyone who loved it, and skips cities and blanks", () => {
    const cands = friendCandidates(places, "Lisbon, Portugal");
    expect(cands.map((c) => c.name)).toEqual(["Memmo Alfama", "Taberna da Rua das Flores", "Café da Garagem"]);
    const flores = cands.find((c) => c.name.startsWith("Taberna"))!;
    expect(flores).toMatchObject({ origin: "friend", source: "friends", category: "food", note: "Get the petiscos" });
    expect(flores.friends!.map((f) => f.userId)).toEqual(["u-omar", "u-sara"]);
    expect(cands.find((c) => c.name === "Memmo Alfama")!.category).toBe("stay");
    // A friend's café reads as coffee to the day check.
    expect(candidateRole(cands.find((c) => c.name === "Café da Garagem")!)).toBe("coffee");
  });

  it("gives a place the same id in the same city on every build, and keeps stays alone when asked", () => {
    expect(friendCandidateId("Lisbon, Portugal", "The Memmo Alfama")).toBe(friendCandidateId("lisbon", "memmo alfama"));
    expect(friendCandidateId("Lisbon", "Memmo Alfama")).not.toBe(friendCandidateId("Porto", "Memmo Alfama"));
    expect(friendCandidates(places, "Lisbon", { staysOnly: true }).map((c) => c.name)).toEqual(["Memmo Alfama"]);
  });

  it("keeps the strongest reason a friend has, without changing their other places", () => {
    const loved = { ...sara };
    const cands = friendCandidates(
      [
        { credit: loved, name: "Park", kind: "drink" },
        { credit: { ...sara, from: "like" }, name: "Park", kind: "drink" },
        { credit: loved, name: "Tasca do Chico", kind: "food" },
      ],
      "Lisbon",
    );
    expect(cands.find((c) => c.name === "Park")!.friends![0]!.from).toBe("like");
    expect(cands.find((c) => c.name === "Tasca do Chico")!.friends![0]!.from).toBe("loved");
    expect(loved.from).toBe("loved");
  });

  it("takes over a Places result for the same place, keeping the friend's credit and Google's details", () => {
    const google: Candidate = {
      id: "gp_1",
      origin: "google",
      name: "Taberna da Rua das Flores",
      neighborhood: "Chiado",
      category: "food",
      source: "reviews",
      placeId: "pid_1",
      rating: 4.6,
      ratingCount: 4000,
      tags: ["restaurant"],
      verification: { placeId: "pid_1", lat: 38.71, lng: -9.14 },
    };
    const other: Candidate = { id: "gp_2", origin: "google", name: "Castelo de São Jorge", category: "culture", source: "reviews", placeId: "pid_2" };
    const merged = withFriendCandidates(friendCandidates(places, "Lisbon"), [google, other]);
    const flores = merged.find((c) => c.name.startsWith("Taberna"))!;
    expect(flores).toMatchObject({ origin: "friend", source: "friends", placeId: "pid_1", neighborhood: "Chiado", rating: 4.6 });
    expect(flores.verification?.lat).toBe(38.71);
    expect(merged.slice(-2).map((c) => c.id)).toEqual(["gp_1", "gp_2"]);
    expect(withFriendCandidates([], [google])).toEqual([google]);
    // The planner gets one of them: the friend's, or Google's when friends are off.
    const on = blendWeights({ weights: defaultWeights(), blocked: [] });
    const off = blendWeights({ weights: defaultWeights(), blocked: [] }, { useCustom: true, weights: {}, blocked: ["friends"] });
    const tabernas = (eff: typeof on) => selectCandidates(merged, eff, req).filter((c) => c.name.startsWith("Taberna"));
    expect(tabernas(on).map((c) => c.origin)).toEqual(["friend"]);
    expect(tabernas(off).map((c) => c.id)).toEqual(["gp_1"]);
  });

  it("finds a friend's place the model named without its id", () => {
    const cands = [...friendCandidates(places, "Lisbon"), { id: "gp_9", origin: "google" as const, name: "Park", category: "drink" as const, source: "reviews" as const }];
    expect(matchFriendCandidate(cands, "the taberna da rua das flores")?.origin).toBe("friend");
    expect(matchFriendCandidate(cands, "Park")).toBeUndefined();
    expect(matchFriendCandidate(cands, "")).toBeUndefined();
  });
});

describe("ranking friends' picks", () => {
  const eff = blendWeights({ weights: defaultWeights(), blocked: ["sponsored"] });
  const base = (c: Partial<Candidate>): Candidate => ({ id: "x", origin: "friend", name: "X", category: "food", source: "friends", ...c });

  it("ranks a friend's loved place above a review-site result, and the trip they're copying above that", () => {
    const loved = scoreCandidate(base({ friends: [omar] }), eff, req);
    const liked = scoreCandidate(base({ friends: [{ ...omar, from: "like" }] }), eff, req);
    const asked = scoreCandidate(base({ friends: [{ ...omar, from: "ask" }] }), eff, req);
    const google = scoreCandidate(base({ origin: "google", source: "reviews", rating: 4.8 }), eff, req);
    expect(loved).toBeGreaterThan(google);
    expect(asked).toBeGreaterThan(loved);
    expect(liked).toBeGreaterThan(asked);
  });

  it("counts a local friend and more friends a little more", () => {
    expect(friendBonus([sara])).toBeGreaterThan(friendBonus([omar]));
    expect(friendBonus([omar, sara])).toBeGreaterThan(friendBonus([sara]));
    expect(friendBonus([])).toBe(0);
  });

  it("follows the traveler's mix: blocked or zero-weight friends are left out", () => {
    const off = blendWeights({ weights: defaultWeights(), blocked: [] }, { useCustom: true, weights: { friends: 0 }, blocked: [] });
    expect(scoreCandidate(base({ friends: [sara] }), off, req)).toBe(Number.NEGATIVE_INFINITY);
    const picked = selectCandidates([base({ id: "fr_1", friends: [sara] }), base({ id: "gp_1", origin: "google", source: "reviews", name: "Y" })], eff, req);
    expect(picked[0]!.id).toBe("fr_1");
  });
});

describe("what a stop shows", () => {
  it("credits a local first and counts the rest", () => {
    expect(friendBadge([omar, sara])).toEqual({ name: "Sara Haddad", local: true, more: 1 });
    expect(friendBadge([omar])).toEqual({ name: "Omar Aziz" });
    expect(friendBadge([omar, { ...sara, from: "ask" }])!.name).toBe("Sara Haddad");
    expect(friendBadge([])).toBeUndefined();
  });
  it("reads as plain English", () => {
    expect(friendPickLabel({ name: "Sara Haddad" })).toBe("Sara's pick");
    expect(friendPickLabel({ name: "James", more: 2 })).toBe("James's pick, and 2 more");
  });
});

describe("asking a friend", () => {
  it("starts with a short question they can edit", () => {
    expect(askQuestion("Lisbon, Portugal", 5)).toBe("Going to Lisbon in May. Any favourites?");
    expect(askQuestion("Lisbon", null)).toBe("Going to Lisbon soon. Any favourites?");
  });

  it("checks questions and answers", () => {
    expect(AskCreateSchema.safeParse({ to: "@sara", city: "Lisbon", question: "Hi" }).success).toBe(false);
    expect(AskCreateSchema.parse({ to: "Sara_h", city: " Lisbon ", question: " Any favourites? " })).toMatchObject({ to: "sara_h", city: "Lisbon", question: "Any favourites?" });
    expect(AskCreateSchema.safeParse({ to: "sara_h", city: "Lisbon", question: "x".repeat(501) }).success).toBe(false);
    const places = Array.from({ length: 13 }, (_, i) => ({ name: `P${i}` }));
    expect(AskReplySchema.safeParse({ action: "answer", answer: "Go", places }).success).toBe(false);
    expect(AskReplySchema.parse({ action: "answer", places: [{ name: "Park" }] })).toEqual({ action: "answer", answer: "", places: [{ name: "Park", note: "" }] });
    expect(AskReplySchema.parse({ action: "decline" })).toEqual({ action: "decline" });
  });

  it("reads stored answers leniently", () => {
    expect(
      askPlacesFrom([{ name: "Park", kind: "drink", note: "Sunset", mapsUrl: "https://www.google.com/maps/search/?api=1&query=Park" }, { name: "" }, "junk", { name: "Lisbon", kind: "city", mapsUrl: "not a url" }]),
    ).toEqual([
      { name: "Park", kind: "drink", note: "Sunset", mapsUrl: "https://www.google.com/maps/search/?api=1&query=Park" },
      { name: "Lisbon", kind: null, note: "", mapsUrl: null },
    ]);
    expect(askPlacesFrom(null)).toEqual([]);
  });
});

describe("credits", () => {
  it("counts the friends helped and the uses per city", () => {
    const s = creditSummary([
      { beneficiaryId: "a", cityKey: "lisbon" },
      { beneficiaryId: "b", cityKey: "lisbon" },
      { beneficiaryId: "a", cityKey: "lisbon" },
      { beneficiaryId: "c", cityKey: "sao paulo" },
      { beneficiaryId: "d", cityKey: "" },
    ]);
    expect(s.friends).toBe(4);
    expect(s.cities).toEqual([
      { key: "lisbon", label: "Lisbon", uses: 3 },
      { key: "sao paulo", label: "Sao Paulo", uses: 1 },
    ]);
  });
});
