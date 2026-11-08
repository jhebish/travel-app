import { describe, expect, it } from "vitest";
import {
  canSeePastTrip,
  dayAfterTrip,
  hiddenWhileAway,
  pastTripForOthers,
  pastTripIsOver,
  pastTripShownFrom,
  todayEverywhere,
  tripIsOver,
  visiblePastTrips,
  type PastTrip,
} from "../src";

const at = (iso: string) => new Date(iso).getTime();
// Saturday 7 November 2026, mid-afternoon in London: already the 7th even at UTC−12.
const NOW = at("2026-11-07T15:00:00Z");

describe("todayEverywhere", () => {
  it("is the date in the last time zone to reach it (UTC−12)", () => {
    expect(todayEverywhere(at("2026-11-08T05:00:00Z"))).toBe("2026-11-07"); // still the 7th west of Hawaii
    expect(todayEverywhere(at("2026-11-08T12:00:00Z"))).toBe("2026-11-08");
    expect(todayEverywhere(new Date("2026-01-01T11:59:00Z"))).toBe("2025-12-31");
  });
});

describe("dayAfterTrip", () => {
  it("is the day after the last day", () => {
    expect(dayAfterTrip("2026-11-07", 3)).toBe("2026-11-10");
    expect(dayAfterTrip("2026-11-07", 1)).toBe("2026-11-08");
    expect(dayAfterTrip("2026-12-30", 3)).toBe("2027-01-02");
    expect(dayAfterTrip("2028-02-28", 2)).toBe("2028-03-01"); // leap year
  });

  it("counts a missing or odd length as one day", () => {
    expect(dayAfterTrip("2026-11-07", null)).toBe("2026-11-08");
    expect(dayAfterTrip("2026-11-07", 0)).toBe("2026-11-08");
    expect(dayAfterTrip("2026-11-07", Number.NaN)).toBe("2026-11-08");
  });

  it("has no answer without a usable start date", () => {
    expect(dayAfterTrip(null, 3)).toBeNull();
    expect(dayAfterTrip(undefined, 3)).toBeNull();
    expect(dayAfterTrip("", 3)).toBeNull();
    expect(dayAfterTrip("next week", 3)).toBeNull();
    expect(dayAfterTrip("2026-13-01", 3)).toBeNull();
    expect(dayAfterTrip("0026-01-01", 3)).toBeNull();
  });
});

describe("tripIsOver and hiddenWhileAway (planned trips)", () => {
  const trip = { startDate: "2026-11-05", days: 3 }; // the 5th, 6th and 7th

  it("treats trips without dates as over", () => {
    expect(tripIsOver({ days: 5 }, NOW)).toBe(true);
    expect(tripIsOver({ startDate: null, days: 5 }, NOW)).toBe(true);
    expect(tripIsOver(null, NOW)).toBe(true);
    expect(hiddenWhileAway({ request: { days: 5 } }, NOW)).toBe(false);
  });

  it("is not over on the last day, or before the trip", () => {
    expect(tripIsOver(trip, NOW)).toBe(false);
    expect(tripIsOver({ startDate: "2026-12-20", days: 7 }, NOW)).toBe(false);
  });

  it("is over once the day after has begun everywhere", () => {
    expect(tripIsOver(trip, at("2026-11-08T11:59:00Z"))).toBe(false); // still the 7th at UTC−12
    expect(tripIsOver(trip, at("2026-11-08T12:00:00Z"))).toBe(true);
    expect(tripIsOver({ startDate: "2026-10-01", days: 7 }, NOW)).toBe(true);
  });

  it("stays hidden from others while away, unless the owner shares it", () => {
    expect(hiddenWhileAway({ request: trip }, NOW)).toBe(true);
    expect(hiddenWhileAway({ request: trip, shareWhileAway: false }, NOW)).toBe(true);
    expect(hiddenWhileAway({ request: trip, shareWhileAway: true }, NOW)).toBe(false);
    expect(hiddenWhileAway({ request: trip }, at("2026-11-09T00:00:00Z"))).toBe(false);
  });
});

describe("pastTripIsOver (past trips, dated by year and month)", () => {
  it("counts undated and earlier trips as over", () => {
    expect(pastTripIsOver({ year: null, month: null }, NOW)).toBe(true);
    expect(pastTripIsOver({ year: 2019, month: 11 }, NOW)).toBe(true);
    expect(pastTripIsOver({ year: 2026, month: 10 }, NOW)).toBe(true);
    expect(pastTripIsOver({ year: 2026, month: null }, NOW)).toBe(true);
  });

  it("keeps this month and later ones back (an import can include trips still ahead)", () => {
    expect(pastTripIsOver({ year: 2026, month: 11 }, NOW)).toBe(false);
    expect(pastTripIsOver({ year: 2026, month: 12 }, NOW)).toBe(false);
    expect(pastTripIsOver({ year: 2027, month: 2 }, NOW)).toBe(false);
    expect(pastTripIsOver({ year: 2027, month: null }, NOW)).toBe(false);
    expect(pastTripIsOver({ year: 2026, month: 11 }, at("2026-12-01T12:00:00Z"))).toBe(true);
  });

  it("says when others will see one", () => {
    expect(pastTripShownFrom({ year: 2026, month: 11 }, NOW)).toBe("2026-12-01");
    expect(pastTripShownFrom({ year: 2026, month: 12 }, NOW)).toBe("2027-01-01");
    expect(pastTripShownFrom({ year: 2027, month: null }, NOW)).toBe("2027-01-01");
    expect(pastTripShownFrom({ year: 2026, month: 3 }, NOW)).toBeNull();
    expect(pastTripShownFrom({ year: null, month: null }, NOW)).toBeNull();
  });
});

const trip = (over: Partial<PastTrip> = {}): PastTrip => ({
  id: "t1",
  city: "Kyoto",
  countryCode: "JP",
  year: 2024,
  month: 5,
  days: 6,
  rating: 5,
  highlights: "Tiny bars in Pontocho",
  tripId: "11111111-1111-4111-8111-111111111111",
  visibility: "followers",
  hideDates: false,
  ...over,
});
const OWNER = { isOwner: true, follows: false };
const FOLLOWER = { isOwner: false, follows: true };
const STRANGER = { isOwner: false, follows: false };

describe("canSeePastTrip", () => {
  it("shows Only me trips to nobody else", () => {
    const t = trip({ visibility: "private" });
    expect(canSeePastTrip(t, OWNER, NOW)).toBe(true);
    expect(canSeePastTrip(t, FOLLOWER, NOW)).toBe(false);
    expect(canSeePastTrip(t, STRANGER, NOW)).toBe(false);
  });

  it("shows Followers trips to followers only", () => {
    expect(canSeePastTrip(trip(), FOLLOWER, NOW)).toBe(true);
    expect(canSeePastTrip(trip(), STRANGER, NOW)).toBe(false);
    // Rows from before the migration have no visibility: followers.
    expect(canSeePastTrip(trip({ visibility: undefined }), FOLLOWER, NOW)).toBe(true);
    expect(canSeePastTrip(trip({ visibility: undefined }), STRANGER, NOW)).toBe(false);
  });

  it("shows Everyone trips to anyone", () => {
    expect(canSeePastTrip(trip({ visibility: "public" }), STRANGER, NOW)).toBe(true);
  });

  it("shows trips that aren't over only to their owner", () => {
    const ahead = trip({ visibility: "public", year: 2026, month: 12 });
    expect(canSeePastTrip(ahead, OWNER, NOW)).toBe(true);
    expect(canSeePastTrip(ahead, FOLLOWER, NOW)).toBe(false);
    expect(canSeePastTrip(ahead, STRANGER, NOW)).toBe(false);
  });
});

describe("pastTripForOthers and visiblePastTrips", () => {
  it("strips the year and month when dates are hidden, and the link to the owner's plan", () => {
    const original = trip({ hideDates: true });
    const seen = pastTripForOthers(original);
    expect(seen).toMatchObject({ city: "Kyoto", countryCode: "JP", year: null, month: null, tripId: null, highlights: "Tiny bars in Pontocho" });
    expect(original.year).toBe(2024); // the owner's copy is untouched
  });

  it("keeps dates that aren't hidden", () => {
    expect(pastTripForOthers(trip())).toMatchObject({ year: 2024, month: 5, tripId: null });
  });

  it("filters and strips for others; owners see everything as it is", () => {
    const list = [
      trip({ id: "a", visibility: "public", hideDates: true }),
      trip({ id: "b", visibility: "followers" }),
      trip({ id: "c", visibility: "private" }),
      trip({ id: "d", visibility: "public", year: 2026, month: 11 }),
    ];
    expect(visiblePastTrips(list, OWNER, NOW)).toBe(list);
    expect(visiblePastTrips(list, FOLLOWER, NOW).map((p) => [p.id, p.year])).toEqual([
      ["a", null],
      ["b", 2024],
    ]);
    expect(visiblePastTrips(list, STRANGER, NOW).map((p) => p.id)).toEqual(["a"]);
  });
});
