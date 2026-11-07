import { describe, expect, it } from "vitest";
import {
  OutlineSchema,
  STOP_JSON_SCHEMA,
  TF,
  TripRequestSchema,
  blendWeights,
  buildOutlinePrompt,
  buildPlanDayPrompt,
  checkDay,
  defaultWeights,
  isVagueActivity,
  nightPlan,
  pickClubNights,
  placesQueries,
  typeformDefinition,
  typeformToRequest,
  wantsClubs,
  wantsNightlife,
  withNightOutQuestion,
  type CheckedStop,
} from "../src";

const req = (r: Record<string, unknown> = {}) => TripRequestSchema.parse({ destination: "Lisbon", days: 3, party: "Couple", budget: "Mid-range", pace: "Balanced", ...r });
const eff = blendWeights({ weights: defaultWeights(), blocked: [] }, { useCustom: false, weights: {}, blocked: [] });
const lists = { alwaysFeature: "", neverRecommend: "" };

describe("what kind of night out", () => {
  it("is drinks for Nightlife, and clubs only when asked", () => {
    expect(wantsNightlife(req({ interests: ["Nightlife"] }))).toBe(true);
    expect(wantsClubs(req({ interests: ["Nightlife"] }))).toBe(false);
    expect(wantsClubs(req({ interests: ["Nightlife"], clubs: true }))).toBe(true);
    // The switch only counts with Nightlife picked; their own words always do.
    expect(wantsClubs(req({ interests: ["Food"], clubs: true }))).toBe(false);
    expect(wantsClubs(req({ interests: ["Food"], extra: "We want to go clubbing on Saturday" }))).toBe(true);
    expect(wantsClubs(req({ extra: "Big techno fans" }))).toBe(true);
    expect(wantsClubs(req({ extra: "We love a supper club" }))).toBe(false);
  });
  it("is never clubs for a family with kids", () => {
    expect(wantsClubs(req({ interests: ["Nightlife"], clubs: true, party: "Family with kids" }))).toBe(false);
    expect(wantsNightlife(req({ interests: ["Nightlife"], party: "Family with kids" }))).toBe(false);
  });
});

describe("club nights", () => {
  it("spreads them out: never two in a row, not the last night of a longer trip, not the first if avoidable", () => {
    expect(pickClubNights(1)).toEqual([0]);
    expect(pickClubNights(2)).toEqual([0]);
    expect(pickClubNights(3)).toEqual([1]);
    expect(pickClubNights(4)).toEqual([0, 2]);
    expect(pickClubNights(5)).toEqual([1, 3]);
    expect(pickClubNights(7)).toEqual([1, 3, 5]);
  });
  it("picks Fridays and Saturdays when the dates are known", () => {
    // 2026-11-12 is a Thursday: Thu, Fri, Sat, Sun.
    expect(pickClubNights(4, { startDate: "2026-11-12" })).toEqual([0, 2]);
    // 2026-11-13 is a Friday: Fri, Sat, Sun → Saturday (the last night is out, Friday is the arrival).
    expect(pickClubNights(3, { startDate: "2026-11-13" })).toEqual([1]);
    // Monday to Sunday: never two in a row, so Saturday and Thursday (and Tuesday), never Sunday (the last night).
    expect(pickClubNights(7, { startDate: "2026-11-09" })).toEqual([1, 3, 5]);
  });
  it("skips nights it's told to (days that start with a long transfer)", () => {
    expect(pickClubNights(4, { avoid: [0] })).toEqual([1]);
    expect(pickClubNights(1, { avoid: [0] })).toEqual([]);
  });
  it("plans each night: a club, drinks, or nothing in particular", () => {
    expect(nightPlan(req({ interests: ["Food"] }), 3)).toEqual([null, null, null]);
    expect(nightPlan(req({ interests: ["Nightlife"] }), 3)).toEqual(["drinks", "drinks", "drinks"]);
    expect(nightPlan(req({ interests: ["Nightlife"], clubs: true }), 3)).toEqual(["drinks", "club", "drinks"]);
  });
});

const stop = (time: string, name: string, role: CheckedStop["role"], more: Partial<CheckedStop> = {}): CheckedStop => ({ time, name, role, ...more });

describe("the day check at night", () => {
  it("passes a club night: dinner, a drink, then the club at midnight", () => {
    const day = [
      stop("12:00", "Brunch", "meal"),
      stop("14:00", "Museu Gulbenkian", "see"),
      stop("20:00", "Dinner", "meal"),
      stop("22:30", "Wine bar", "drinks"),
      stop("00:30", "Lux Frágil", "club", { kind: "nightlife", cost: "€15 cover" }),
    ];
    expect(checkDay(day, { clubNight: true })).toEqual([]);
  });
  it("doesn't count drinks after dinner as eating in a row", () => {
    const day = [stop("13:00", "Lunch", "meal"), stop("15:00", "Castle", "see"), stop("20:00", "Dinner", "meal"), stop("21:30", "Bar 1", "drinks"), stop("23:00", "Bar 2", "drinks")];
    expect(checkDay(day)).toEqual([]);
  });
  it("sends a club to the end of the night", () => {
    const early = [stop("10:00", "Castle", "see"), stop("13:00", "Lunch", "meal"), stop("19:00", "Club", "club", { kind: "nightlife", cost: "€10" }), stop("21:00", "Dinner", "meal")];
    expect(checkDay(early).map((i) => i.code)).toContain("club_timing");
    const sightAfter = [stop("13:00", "Lunch", "meal"), stop("23:30", "Club", "club", { kind: "nightlife", cost: "€10" }), stop("02:00", "Viewpoint", "see")];
    expect(checkDay(sightAfter).map((i) => i.code)).toContain("club_timing");
  });
  it("asks for the club on a club night, and a late start the morning after", () => {
    const noClub = [stop("10:00", "Castle", "see"), stop("13:00", "Lunch", "meal"), stop("20:00", "Dinner", "meal"), stop("22:00", "Bar", "drinks")];
    expect(checkDay(noClub, { clubNight: true }).map((i) => i.code)).toEqual(["no_club"]);
    expect(checkDay(noClub, { lateStart: true }).map((i) => i.code)).toEqual(["early_start"]);
    const slow = [stop("11:30", "Brunch", "meal"), stop("13:30", "Castle", "see"), stop("20:00", "Dinner", "meal"), stop("22:00", "Bar", "drinks")];
    expect(checkDay(slow, { lateStart: true })).toEqual([]);
  });
});

describe("a plan, not an idea", () => {
  it("tells a vague activity from a real place or operator", () => {
    expect(isVagueActivity("Felucca ride on the Nile")).toBe(true);
    expect(isVagueActivity("Old Cairo walking tour", "Cairo, Egypt")).toBe(true);
    expect(isVagueActivity("Hot air balloon over Luxor", "Luxor")).toBe(true);
    expect(isVagueActivity("Sunset cruise")).toBe(true);
    expect(isVagueActivity("Cooking class at Sukkar Kitchen")).toBe(false);
    expect(isVagueActivity("Felucca from Dok Dok Landing")).toBe(false);
  });
  it("sends back a vague activity and a missing price, but not a real candidate", () => {
    const day = (s: CheckedStop) => [stop("09:00", "Egyptian Museum", "see", { cost: "EGP 550" }), stop("13:00", "Lunch", "meal"), s, stop("20:00", "Dinner", "meal")];
    const vague = checkDay(day(stop("16:00", "Felucca ride on the Nile", "do", { kind: "activity", cost: "EGP 500 a boat" })), { place: "Cairo, Egypt" });
    expect(vague.map((i) => i.code)).toEqual(["vague_activity"]);
    expect(vague[0]!.fix).toMatch(/dock, boat company, tour operator/);
    const unpriced = checkDay(day(stop("16:00", "Felucca at Dok Dok Landing", "do", { kind: "activity" })));
    expect(unpriced.map((i) => i.code)).toEqual(["no_price"]);
    // Picked from Google's results: a real place, even with a plain name.
    expect(checkDay(day(stop("16:00", "Felucca ride", "do", { kind: "activity", cost: "EGP 500", grounded: true })))).toEqual([]);
    // A club without its cover.
    expect(checkDay([stop("20:00", "Dinner", "meal"), stop("00:30", "Club", "club", { kind: "nightlife" })]).map((i) => i.code)).toEqual(["no_price"]);
  });
  it("asks for a price on every stop", () => {
    expect(STOP_JSON_SCHEMA.required).toContain("cost");
  });
});

describe("searching", () => {
  const queries = (r: Record<string, unknown>) => placesQueries(req(r)).map((q) => q.query);
  it("looks for bars for Nightlife, and clubs only when asked", () => {
    expect(queries({ interests: ["Nightlife"] })).toContain("wine bars and cocktail bars locals love in Lisbon");
    expect(queries({ interests: ["Nightlife"] }).some((q) => /nightclub/.test(q))).toBe(false);
    expect(queries({ interests: ["Nightlife"], clubs: true })).toContain("nightclubs where locals go dancing in Lisbon");
    expect(queries({ interests: ["Nightlife"], clubs: true, party: "Family with kids" }).some((q) => /nightclub|bars/.test(q))).toBe(false);
  });
  it("always looks for real operators, and never drops the hotel search", () => {
    const many = placesQueries(req({ interests: ["Nightlife", "Art & design", "History", "Nature & outdoors", "Markets & shopping", "Live music", "Wellness"], clubs: true, stay: { on: true, styles: ["Boutique", "Luxury"], price: "$150–300" } }));
    expect(many).toHaveLength(8);
    expect(many.map((q) => q.query)).toContain("boat trips, tours and classes in Lisbon");
    expect(many.filter((q) => q.category === "stay")).toHaveLength(2);
  });
});

describe("the prompts", () => {
  it("tells the outline and each day which nights end at a club", () => {
    const r = req({ interests: ["Nightlife"], clubs: true });
    const outline = buildOutlinePrompt(r, eff, lists, []);
    expect(outline).toMatch(/NIGHT OUT/);
    expect(outline).toMatch(/Club nights: Day 2\./);
    const o = { ...OutlineSchema.parse({ title: "Lisbon", days: [1, 2, 3].map((i) => ({ label: `Day ${i}`, theme: "t", area: "a", candidateIds: [] })) }), nights: nightPlan(r, 3) };
    expect(buildPlanDayPrompt(r, eff, lists, o, 1, [])).toMatch(/Tonight is a club night/);
    expect(buildPlanDayPrompt(r, eff, lists, o, 2, [])).toMatch(/start this day at 11:00 or later/);
    expect(buildPlanDayPrompt(r, eff, lists, o, 0, [])).toMatch(/Tonight: a drink at a good bar near dinner\. No club\./);
  });
  it("says nothing about nights out when they didn't ask", () => {
    expect(buildOutlinePrompt(req({ interests: ["Food"] }), eff, lists, [])).not.toMatch(/NIGHT OUT/);
  });
  it("asks for real operators and prices", () => {
    const o = OutlineSchema.parse({ title: "x", days: [{ label: "Day 1", theme: "t", area: "a", candidateIds: [] }] });
    const p = buildPlanDayPrompt(req(), eff, lists, o, 0, []);
    expect(p).toMatch(/Never a generic activity like "felucca ride"/);
    expect(p).toMatch(/"cost" on every stop/);
  });
});

describe("the Typeform question", () => {
  it("asks new forms about clubs right after interests, only when Nightlife is picked", () => {
    const def = typeformDefinition();
    const refs = def.fields.map((f) => f.ref);
    expect(refs.indexOf(TF.clubs)).toBe(refs.indexOf(TF.interests) + 1);
    const jump = def.logic.find((l) => l.ref === TF.interests)!;
    expect(JSON.stringify(jump)).toMatch(/"op":"is_not".*interests_nightlife/);
    expect(JSON.stringify(jump)).toMatch(/"value":"pace"/);
  });
  it("reads the answer", () => {
    const base = [
      { field: { ref: TF.destination }, type: "text", text: "Berlin" },
      { field: { ref: TF.interests }, type: "choices", choices: { refs: ["interests_nightlife"] } },
    ];
    expect(typeformToRequest([...base, { field: { ref: TF.clubs }, type: "boolean", boolean: true }]).clubs).toBe(true);
    expect(typeformToRequest(base).clubs).toBe(false);
  });
  it("adds the question to an existing form without touching the rest", () => {
    const live = {
      id: "abc",
      title: "My edited title",
      fields: [
        { id: "f1", ref: TF.destination, title: "Where to, friend?" },
        { id: "f2", ref: TF.interests, title: "Into?", properties: { choices: [{ id: "c1", ref: "interests_food", label: "Food" }, { id: "c2", ref: "my_own_ref", label: "Nightlife" }] } },
        { id: "f3", ref: TF.pace, title: "Pace?" },
      ],
      logic: [{ type: "field", ref: TF.stayOn, actions: [{ action: "jump" }] }],
    };
    const out = withNightOutQuestion(live);
    expect(out.form).not.toBeNull();
    const form = out.form!;
    expect(form.title).toBe("My edited title");
    expect(form.fields!.map((f) => f.ref)).toEqual([TF.destination, TF.interests, TF.clubs, TF.pace]);
    expect(form.fields![0]).toEqual(live.fields[0]);
    expect(form.logic).toHaveLength(2);
    expect(JSON.stringify(form.logic![1])).toMatch(/my_own_ref/);
    // Run twice: nothing more to add.
    expect(withNightOutQuestion(form)).toEqual({ form: null, why: "already there" });
  });
});
