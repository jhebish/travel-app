import { describe, expect, it } from "vitest";
import {
  GMAIL_YEARS,
  MAX_GMAIL_MESSAGES,
  gmailForModel,
  gmailHome,
  gmailImport,
  gmailPrompt,
  gmailSearches,
  redactEmailText,
  senderDomain,
  senderName,
  type GmailMessageLike,
} from "../src/imports";
import { TasteSignalSchema, type TasteSignal } from "../src/taste";

const NOW = Date.parse("2026-11-07T12:00:00Z");
const DAY = 864e5;
/** An email that arrived `daysAgo` before NOW. */
const mail = (id: string, from: string, subject: string, daysAgo: number, snippet = ""): GmailMessageLike => ({ id, from, subject, snippet, sentAt: NOW - daysAgo * DAY });
/** Every signal must reach the API unchanged by its schema. */
const valid = (signals: TasteSignal[]) => {
  for (const s of signals) expect(TasteSignalSchema.parse(s)).toEqual(s);
  return signals;
};
const brief = (s: TasteSignal) => ({ kind: s.kind, name: s.name, city: s.city ?? null, countryCode: s.countryCode ?? null, date: s.date ?? null });

describe("gmailSearches", () => {
  const searches = gmailSearches(NOW);

  it("searches each year back separately, leaving promotions out", () => {
    expect(searches.length).toBe(GMAIL_YEARS * 5);
    for (const s of searches) {
      expect(s.q).toContain("-category:promotions");
      expect(s.q).toMatch(/after:\d{4}\/\d{2}\/\d{2} before:\d{4}\/\d{2}\/\d{2}$/);
    }
    expect(searches[0]!.q).toContain("before:2026/11/08");
    expect(searches.at(-1)!.q).toContain("after:2020/11/");
  });

  it("looks for the booking sites, airlines, restaurant and tour sites named in the brief", () => {
    const all = searches.map((s) => s.q).join(" ");
    for (const d of ["booking.com", "airbnb.com", "expedia.com", "hotels.com", "vrbo.com", "marriott.com", "delta.com", "resy.com", "opentable.com", "exploretock.com", "sevenrooms.com", "getyourguide.com", "viator.com"]) {
      expect(all).toContain(`from:${d}`);
    }
    expect(all).toContain('subject:"reservation confirmed"');
    expect(all).toContain('subject:"booking confirmation"');
    expect(all).toContain('subject:"your trip"');
    // Ride receipts say "your trip" too.
    expect(all).toContain("-from:uber.com");
  });

  it("reads about as many emails as the cap", () => {
    const total = searches.reduce((n, s) => n + s.max, 0);
    expect(total).toBeGreaterThan(MAX_GMAIL_MESSAGES * 0.8);
    expect(total).toBeLessThan(MAX_GMAIL_MESSAGES * 1.2);
  });
});

describe("what the model is sent", () => {
  it("keeps only the sender's domain", () => {
    expect(senderDomain("Resy <no-reply@resy.com>")).toBe("resy.com");
    expect(senderDomain("\"Marriott Bonvoy\" <reservations@email.marriott.com>")).toBe("marriott.com");
    expect(senderDomain("qantas@e.qantas.com.au")).toBe("qantas.com.au");
    expect(senderDomain("ANA <info@mail.ana.co.jp>")).toBe("ana.co.jp");
    expect(senderDomain("Someone without an address")).toBe("");
    expect(senderName("booking.com")).toBe("Booking.com");
    expect(senderName("example.org")).toBeNull();
  });

  it("takes out greetings, addresses, links, phone numbers, card and booking numbers", () => {
    const t = redactEmailText(
      "Hi James, your stay at Memmo Alfama is confirmed for May 14, 2025. Confirmation HMQ3X9ZK2 &amp; PIN 4821. Questions? Call +351 21 049 5660 or (212) 555-1234, email help@memmo.pt or visit https://memmo.pt/manage?id=123. Card 4111 1111 1111 1111. Booking no. 4012345678.",
    );
    expect(t).toContain("your stay at Memmo Alfama is confirmed for May 14, 2025.");
    expect(t).toContain("&");
    for (const gone of ["James", "HMQ3X9ZK2", "4821", "+351", "555-1234", "help@memmo.pt", "https://", "4111", "4012345678"]) expect(t).not.toContain(gone);
  });

  it("keeps dates, times and party sizes", () => {
    expect(redactEmailText("Table for 2 on 2025-05-14 at 20:00 (14.05.2025)")).toBe("Table for 2 on 2025-05-14 at 20:00 (14.05.2025)");
    expect(redactEmailText("Dress code: smart casual")).toBe("Dress code: smart casual");
  });

  it("decodes entities and drops invisible padding", () => {
    expect(redactEmailText("Your reservation at L&#39;Avant Comptoir&nbsp;is confirmed\u200C\u200C\u200C")).toBe("Your reservation at L'Avant Comptoir is confirmed");
  });

  it("sends a short line per email, numbered", () => {
    const m = mail("a1", "OpenTable <member_services@opentable.com>", "Reservation Confirmed – Carbone", 30, `Hi Sam, you're all set.${" Carbone, Thursday, October 9 at 8:00 PM, party of 2.".repeat(6)}`);
    const e = gmailForModel(m);
    expect(e).toMatchObject({ domain: "opentable.com", sent: "2026-10-08", subject: "Reservation Confirmed – Carbone" });
    expect(e.text.length).toBeLessThanOrEqual(220);
    expect(e.text).not.toContain("Sam");
    const p = gmailPrompt([e], 40);
    expect(p).toContain('40. from opentable.com · sent 2026-10-08 · "Reservation Confirmed – Carbone"');
    expect(p).not.toContain("member_services");
  });
});

describe("gmailImport", () => {
  it("turns bookings into signals and trips, checked against their email", () => {
    const messages = [
      mail("m0", "Booking.com <noreply@booking.com>", "Booking confirmed: Memmo Alfama", 560),
      mail("m1", "TAP <no-reply@flytap.com>", "Your trip to Lisbon", 570),
      mail("m2", "Resy <no-reply@resy.com>", "Your reservation at Lilia", 20),
    ];
    const r = gmailImport(
      [
        { i: 0, kind: "stay", name: "Memmo Alfama", city: "Lisboa", countryCode: "pt", date: "2025-05-14" },
        { i: 1, kind: "city", name: "Lisbon, Portugal", countryCode: "PT", date: "2025-05-13", from: "New York" },
        { i: 2, kind: "food", name: "Lilia", city: "Brooklyn", countryCode: "US", date: "2026-10-20" },
        { i: 7, kind: "food", name: "Not an email we sent", city: "Paris", date: "2026-01-01" },
        { i: 0, kind: "hotel", name: "Wrong kind" },
        { i: 0, kind: "stay", name: "" },
      ],
      messages,
      { now: NOW },
    );
    expect(valid(r.signals).map(brief)).toEqual([
      { kind: "city", name: "Lisbon", city: "Lisbon", countryCode: "PT", date: "2025-05-13" },
      { kind: "stay", name: "Memmo Alfama", city: "Lisbon", countryCode: "PT", date: "2025-05-14" },
      { kind: "food", name: "Lilia", city: "Brooklyn", countryCode: "US", date: "2026-10-20" },
    ]);
    expect(r.signals.map((s) => [s.source, s.ref, s.note])).toEqual([
      ["gmail", "gmail:m1", "Booked with TAP Air Portugal"],
      ["gmail", "gmail:m0", "Booked with Booking.com"],
      ["gmail", "gmail:m2", "Booked with Resy"],
    ]);
    expect(r.trips.map((t) => [t.city, t.countryCode, t.year, t.month])).toEqual([
      ["Brooklyn", "US", 2026, 10],
      ["Lisbon", "PT", 2025, 5],
    ]);
  });

  it("leaves out bookings still to come and dates that don't fit the email", () => {
    const messages = [mail("f0", "x@airbnb.com", "Reservation confirmed for Kyoto", 10), mail("f1", "x@resy.com", "Your reservation", 3)];
    const r = gmailImport(
      [
        { i: 0, kind: "stay", name: "Airbnb in Kyoto", city: "Kyoto", date: "2027-03-02" },
        // The model guessed the wrong year: three years before the email came.
        { i: 1, kind: "food", name: "Via Carota", city: "New York", countryCode: "US", date: "2023-11-02" },
      ],
      messages,
      { now: NOW },
    );
    expect(r.signals.map(brief)).toEqual([{ kind: "food", name: "Via Carota", city: "New York", countryCode: "US", date: null }]);
    expect(r.trips).toEqual([]);
  });

  it("drops cancelled bookings along with their confirmation", () => {
    const messages = [
      mail("c0", "x@opentable.com", "Reservation confirmed", 40),
      mail("c1", "x@opentable.com", "Your reservation has been cancelled", 38),
      mail("c2", "x@viator.com", "Booking confirmed", 100),
      mail("c3", "x@viator.com", "Cancellation", 90),
    ];
    const r = gmailImport(
      [
        { i: 0, kind: "food", name: "Le Bernardin", city: "New York", date: "2026-10-01" },
        { i: 1, kind: "food", name: "Le Bernardin", city: "New York", date: "2026-10-01", cancelled: true },
        { i: 2, kind: "activity", name: "Sintra day trip", city: "Sintra", countryCode: "PT", date: "2026-08-01" },
        // No day given: cancels that tour whatever its day.
        { i: 3, kind: "activity", name: "Sintra Day Trip", city: "Sintra", cancelled: true },
      ],
      messages,
      { now: NOW },
    );
    expect(r.signals).toEqual([]);
    expect(r.trips).toEqual([]);
  });

  it("merges the same visit across emails, keeping the oldest email's ref", () => {
    const messages = [
      mail("z9", "x@marriott.com", "Reminder: your stay", 5),
      mail("a1", "x@marriott.com", "Reservation confirmation", 60),
      mail("b2", "x@marriott.com", "How was your stay?", 1),
    ];
    const stay = { kind: "stay", name: "The Ritz-Carlton, Kyoto", city: "Kyoto", countryCode: "JP", date: "2026-11-02" };
    const r = gmailImport([{ i: 0, ...stay }, { i: 1, ...stay }, { i: 2, ...stay, city: null }], messages, { now: NOW });
    expect(r.signals).toHaveLength(1);
    expect(r.signals[0]).toMatchObject({ ref: "gmail:a1", city: "Kyoto", note: "Booked with Marriott" });
  });

  it("keeps each year's visit for trips, one signal per place for taste", () => {
    const messages = [mail("y0", "x@booking.com", "Booking confirmation", 900), mail("y1", "x@booking.com", "Booking confirmation", 200)];
    const stay = { kind: "stay", name: "Memmo Alfama", city: "Lisbon", countryCode: "PT" };
    const r = gmailImport(
      [
        { i: 0, ...stay, date: "2024-05-01" },
        { i: 1, ...stay, date: "2026-04-25" },
      ],
      messages,
      { now: NOW },
    );
    expect(r.signals).toHaveLength(1);
    expect(r.signals[0]).toMatchObject({ ref: "gmail:y0", date: "2024-05-01" });
    expect(r.trips.map((t) => t.year)).toEqual([2026, 2024]);
  });

  it("gives each booking in a package email its own ref, whatever order the model lists them", () => {
    const messages = [mail("p0", "x@expedia.com", "Your trip to Cancún", 30)];
    const flight = { i: 0, kind: "city", name: "Cancún", countryCode: "MX", date: "2026-10-10" };
    const hotel = { i: 0, kind: "stay", name: "Casa Malca", city: "Tulum", countryCode: "MX", date: "2026-10-10" };
    const a = gmailImport([flight, hotel], messages, { now: NOW });
    const b = gmailImport([hotel, flight], messages, { now: NOW });
    expect(a.signals.map((s) => s.ref).sort()).toEqual(b.signals.map((s) => s.ref).sort());
    expect(new Set(a.signals.map((s) => s.ref)).size).toBe(2);
    expect(a.signals.find((s) => s.kind === "stay")?.ref).toBe("gmail:p0");
  });

  it("doesn't make trips of home: the profile's city, or where the flights leave from", () => {
    const messages = Array.from({ length: 8 }, (_, k) => mail(`h${k}`, "x@resy.com", "Your reservation", 400 - k * 40));
    const dinners = ["2025-10-10", "2025-12-12", "2026-02-14", "2026-04-18"].map((date, k) => ({ i: k, kind: "food", name: `Place ${k}`, city: "New York", countryCode: "US", date }));
    const flights = [
      { i: 4, kind: "city", name: "Lisbon", countryCode: "PT", date: "2026-05-01", from: "New York" },
      { i: 5, kind: "city", name: "New York", countryCode: "US", date: "2026-05-09", from: "Lisbon" },
      { i: 6, kind: "city", name: "Mexico City", countryCode: "MX", date: "2026-07-01", from: "New York" },
    ];
    const trips = (home?: string) => gmailImport([...dinners, ...flights], messages, { now: NOW, home }).trips.map((t) => t.city);
    expect(trips()).toEqual(["Mexico City", "Lisbon"]);
    // The profile's home counts as well as the one the bookings point to.
    expect(trips("Ciudad de México, CDMX")).toEqual(["Lisbon"]);
    // Taste still gets the dinners at home.
    expect(gmailImport([...dinners, ...flights], messages, { now: NOW }).signals.filter((s) => s.kind === "food")).toHaveLength(4);
  });

  it("ignores junk from the model", () => {
    expect(gmailImport([null, 3, "x", { i: "0", kind: "food", name: "Lilia", city: "Brooklyn", countryCode: "USA" }], [mail("j0", "x@resy.com", "Your reservation", 5)], { now: NOW }).signals.map(brief)).toEqual([
      { kind: "food", name: "Lilia", city: "Brooklyn", countryCode: "US", date: null },
    ]);
    expect(gmailImport(undefined as unknown as unknown[], [], { now: NOW })).toEqual({ signals: [], trips: [] });
    const named = gmailImport([{ i: 0, kind: "stay", name: `Casa ${"Grande ".repeat(30)}`, city: "Porto", countryCode: "Portugal" }], [mail("j1", "x@booking.com", "Booking confirmation", 5)], { now: NOW });
    expect(named.signals[0]).toMatchObject({ countryCode: "PT", city: "Porto" });
    expect(named.signals[0]!.name.length).toBeLessThanOrEqual(120);
  });
});

describe("gmailHome", () => {
  const dinner = (city: string, date: string) => ({ signal: { kind: "food" as const, city, date } });
  it("needs restaurant bookings over several months, and no hotel there", () => {
    const nyc = ["2025-01-05", "2025-03-05", "2025-06-05", "2025-09-05"].map((d) => dinner("New York", d));
    expect(gmailHome(nyc)).toBe("new york");
    // A week of dinners on one trip isn't home.
    expect(gmailHome(["2025-06-01", "2025-06-02", "2025-06-03", "2025-06-04"].map((d) => dinner("Tokyo", d)))).toBeNull();
    expect(gmailHome([...nyc, { signal: { kind: "stay", city: "New York", date: "2025-02-01" } }])).toBeNull();
  });
});
