import { describe, expect, it } from "vitest";
import { calendarSignals, dedupeSignals, guessKind, type CalendarEventLike } from "../src/imports";
import { TasteSignalSchema, type TasteSignal } from "../src/taste";

/** Every signal must reach the API unchanged by its schema. */
function valid(signals: TasteSignal[]): TasteSignal[] {
  for (const s of signals) expect(TasteSignalSchema.parse(s)).toEqual(s);
  return signals;
}
const signalsOf = (events: CalendarEventLike[], source: "ics" | "google_calendar" = "ics") => valid(calendarSignals(events, source));
const brief = (s: TasteSignal) => ({ kind: s.kind, name: s.name, city: s.city ?? null, countryCode: s.countryCode ?? null });
/** What one event becomes, in short. */
const one = (ev: CalendarEventLike) => signalsOf([ev]).map(brief);
/** A timed event on the phone, 7–9pm local. */
const at = (summary: string, extra: Partial<CalendarEventLike> = {}): CalendarEventLike => ({
  start: "2025-06-10T19:00:00",
  end: "2025-06-10T21:00:00",
  ...extra,
  summary,
});
/** An all-day event; `end` is exclusive, as calendars write it. */
const days = (summary: string, start: string, end: string, extra: Partial<CalendarEventLike> = {}): CalendarEventLike => ({ start, end, ...extra, summary });

describe("calendarSignals: flights", () => {
  it("turns a Google flight into the destination city", () => {
    const [s, ...rest] = signalsOf(
      [{ id: "primary:tp202", summary: "Flight to Lisbon (TP 202)", location: "John F. Kennedy International Airport", start: "2025-05-10T22:30:00-04:00", end: "2025-05-11T10:25:00+01:00" }],
      "google_calendar",
    );
    expect(rest).toEqual([]);
    expect(s).toMatchObject({ source: "google_calendar", ref: "cal:primary:tp202", kind: "city", name: "Lisbon", city: "Lisbon", countryCode: "PT", date: "2025-05-10", note: "Flight TP 202" });
  });

  it("reads airport codes, arrows and other languages", () => {
    expect(one(at("UA 123 SFO to EWR"))).toEqual([{ kind: "city", name: "New York", city: "New York", countryCode: "US" }]);
    expect(one(at("✈️ JFK → LIS"))[0]?.name).toBe("Lisbon");
    expect(one(at("Vuelo a Lisboa (TP 1023)"))[0]?.name).toBe("Lisbon");
    expect(one(at("Flug nach Lissabon (LH 1166)"))[0]?.name).toBe("Lisbon");
    expect(one(at("Flight: London Heathrow to Tokyo Haneda (BA 5)"))[0]).toMatchObject({ name: "Tokyo", countryCode: "JP" });
  });

  it("leaves out check-in reminders and confirmations", () => {
    expect(signalsOf([at("Check in for flight TP 202"), at("Flight confirmation TP 202"), at("Reminder: flight to Lisbon tomorrow")])).toEqual([]);
  });

  it("leaves out flights home once it's clear where home is", () => {
    const signals = signalsOf([
      at("JFK-LIS", { id: "out", start: "2025-05-10T18:00:00" }),
      at("Flight to Lisbon (TP 202)", { id: "tp202", start: "2025-05-10T22:30:00" }),
      at("LIS → JFK", { id: "back", start: "2025-05-17T12:00:00" }),
      at("Flight to New York (TP 201)", { id: "tp201", start: "2025-05-17T12:30:00" }),
    ]);
    expect(signals.map((s) => `${s.name} ${s.date}`)).toEqual(["Lisbon 2025-05-10"]);
  });

  it("doesn't take a return leg's origin for home", () => {
    const signals = signalsOf([at("Flight to Lisbon (TP 202)", { start: "2025-05-10T22:30:00" }), at("LIS → JFK", { start: "2025-05-17T12:00:00" })]);
    expect(signals.map((s) => s.name)).toEqual(["Lisbon", "New York"]);
  });
});

describe("calendarSignals: stays", () => {
  it("reads a hotel stay with its city, dated the day of check-in", () => {
    const [s] = signalsOf([days("Stay at Hotel Avenida Palace", "2025-06-11", "2025-06-14", { location: "R. 1º de Dezembro 123, 1200-359 Lisboa, Portugal" })]);
    expect(s).toMatchObject({ kind: "stay", name: "Hotel Avenida Palace", city: "Lisbon", countryCode: "PT", date: "2025-06-11" });
  });

  it("reads Airbnb stays, named or not", () => {
    const address = "R. de São Miguel 20, 1100-544 Lisboa, Portugal";
    expect(one(days("Airbnb: Sunny loft in Alfama", "2025-06-11", "2025-06-14", { location: address }))).toEqual([
      { kind: "stay", name: "Sunny loft in Alfama", city: "Lisbon", countryCode: "PT" },
    ]);
    expect(signalsOf([days("Airbnb: Sunny loft in Alfama", "2025-06-11", "2025-06-14", { location: address })])[0]?.note).toBe("Airbnb reservation");
    expect(one(days("Lisbon (Airbnb)", "2025-06-11", "2025-06-14"))).toEqual([{ kind: "stay", name: "Airbnb in Lisbon", city: "Lisbon", countryCode: "PT" }]);
    expect(one(days("Airbnb", "2025-06-11", "2025-06-14", { location: address }))).toEqual([{ kind: "stay", name: "Airbnb in Lisbon", city: "Lisbon", countryCode: "PT" }]);
  });

  it("finds the hotel in the location when the title is just 'Hotel'", () => {
    expect(one(days("Hotel", "2025-06-11", "2025-06-14", { location: "The Hoxton, Williamsburg, 97 Wythe Ave, Brooklyn, NY 11249, USA" }))).toEqual([
      { kind: "stay", name: "The Hoxton", city: "Brooklyn", countryCode: "US" },
    ]);
  });

  it("reads hotel names, booking apps and confirmations in the notes", () => {
    expect(one(days("Four Seasons Resort Bali at Sayan", "2025-07-01", "2025-07-05"))[0]).toMatchObject({ kind: "stay", name: "Four Seasons Resort Bali at Sayan" });
    expect(one(days("Check-in: The Ritz-Carlton, Kyoto", "2025-07-01", "2025-07-05"))[0]).toMatchObject({ kind: "stay", city: "Kyoto", countryCode: "JP" });
    expect(one(days("Marriott Bonvoy: Lisbon Marriott Hotel", "2025-07-01", "2025-07-05"))[0]?.name).toBe("Lisbon Marriott Hotel");
    const [booked] = signalsOf([days("Memmo Alfama", "2025-06-11", "2025-06-14", { description: "Booking.com confirmation 4412 · 3 nights" })]);
    expect(booked).toMatchObject({ kind: "stay", name: "Memmo Alfama", note: "Booking.com reservation" });
  });

  it("leaves out meetings at hotels and stays at home", () => {
    expect(signalsOf([at("Meeting at Hotel Indigo"), at("Stay home"), days("Book Airbnb in Lisbon", "2025-06-01", "2025-06-02")])).toEqual([]);
  });
});

describe("calendarSignals: restaurant reservations", () => {
  it("reads Resy reservations", () => {
    const [lilia] = signalsOf([at("Reservation at Lilia", { location: "567 Union Ave, Brooklyn, NY 11211, USA", description: "Party of 2. Manage at https://resy.com/r/8812" })]);
    expect(lilia).toMatchObject({ kind: "food", name: "Lilia", city: "Brooklyn", countryCode: "US", date: "2025-06-10", note: "Resy reservation" });
    expect(signalsOf([at("Dinner at Via Carota (Resy)")])[0]).toMatchObject({ kind: "food", name: "Via Carota", note: "Resy reservation" });
  });

  it("reads OpenTable, Tock and SevenRooms entries", () => {
    const names = (ev: CalendarEventLike) => signalsOf([ev]).map((s) => `${s.name} · ${s.note}`);
    expect(names(at("OpenTable reservation at Carbone", { location: "181 Thompson St, New York, NY 10012, USA" }))).toEqual(["Carbone · OpenTable reservation"]);
    expect(names(at("Alinea - Tock"))).toEqual(["Alinea · Tock reservation"]);
    expect(names(at("Tock: Alinea"))).toEqual(["Alinea · Tock reservation"]);
    expect(names(at("The Grill - Reservation for 2", { description: "Powered by SevenRooms. Reservation confirmed." }))).toEqual(["The Grill · SevenRooms reservation"]);
  });

  it("reads a bare restaurant name with the booking in the notes", () => {
    expect(signalsOf([at("Lilia", { description: "Resy · Party of 2 · Confirmation #8812" })])[0]).toMatchObject({ kind: "food", name: "Lilia", note: "Resy reservation" });
  });

  it("tells bars and cafés from restaurants", () => {
    expect(one(at("Drinks @ Death & Co", { location: "433 E 6th St, New York, NY 10009, USA" }))).toEqual([{ kind: "drink", name: "Death & Co", city: "New York", countryCode: "US" }]);
    expect(one(at("Coffee with Ana at Blue Bottle"))[0]).toMatchObject({ kind: "coffee", name: "Blue Bottle" });
    expect(one(at("Bar Pisellino reservation"))[0]).toMatchObject({ kind: "drink", name: "Bar Pisellino" });
  });

  it("finds the restaurant in the location when the title is just 'Dinner'", () => {
    expect(one(at("Dinner", { location: "Via Carota, 51 Grove St, New York, NY 10014, USA" }))).toEqual([{ kind: "food", name: "Via Carota", city: "New York", countryCode: "US" }]);
  });

  it("keeps names that start with a number, but not times", () => {
    expect(one(at("Dinner at 11 Madison Park"))[0]?.name).toBe("11 Madison Park");
    expect(signalsOf([at("Dinner at 8pm"), at("Table for 2 at 8")])).toEqual([]);
  });

  it("leaves out meals at home or the office, and other reservations", () => {
    const events = [
      at("Lunch", { location: "Office" }),
      at("Dinner at Mom's"),
      at("Call about dinner at Carbone"),
      at("Lunch with Sam", { location: "Bryant Park, New York, NY 10018, USA" }),
      at("Car reservation"),
      at("Team lunch", { location: "WeWork, 115 W 18th St, New York" }),
    ];
    expect(signalsOf(events)).toEqual([]);
  });
});

describe("calendarSignals: tours and tickets", () => {
  it("reads tours booked through GetYourGuide, Viator and Airbnb Experiences", () => {
    const [gyg] = signalsOf([at("GetYourGuide: Sintra, Pena Palace & Cascais Day Trip", { start: "2025-06-12T09:00:00", end: "2025-06-12T18:00:00" })]);
    expect(gyg).toMatchObject({ kind: "activity", name: "Sintra, Pena Palace & Cascais Day Trip", city: "Sintra", countryCode: "PT", note: "GetYourGuide booking" });
    expect(one(at("Viator booking: Colosseum Underground Tour"))[0]).toMatchObject({ kind: "activity", name: "Colosseum Underground Tour" });
    expect(one(at("Airbnb Experience: Pasta making with Nonna", { location: "Trastevere, Rome, Italy" }))).toEqual([
      { kind: "activity", name: "Pasta making", city: "Rome", countryCode: "IT" },
    ]);
  });

  it("reads tours, tastings, classes and shows by their wording", () => {
    const kinds = signalsOf([
      at("Walking tour of Alfama", { id: "a" }),
      at("Food tour in Lisbon", { id: "b" }),
      at("Wine tasting at Quinta da Aveleda", { id: "c" }),
      at("Pasta making class", { id: "d" }),
      at("Fado show at Clube de Fado", { id: "e" }),
      at("The Eras Tour", { id: "f", location: "Estádio da Luz, Lisboa, Portugal" }),
    ]).map((s) => `${s.kind}: ${s.name} (${s.city ?? "?"})`);
    expect(kinds).toEqual([
      "activity: Walking tour of Alfama (?)",
      "activity: Food tour in Lisbon (Lisbon)",
      "activity: Wine tasting at Quinta da Aveleda (?)",
      "activity: Pasta making class (?)",
      "activity: Fado show at Clube de Fado (?)",
      "activity: The Eras Tour (Lisbon)",
    ]);
  });

  it("reads tickets as the thing they're for", () => {
    expect(one(at("Tickets: Louvre Museum"))[0]).toMatchObject({ kind: "activity", name: "Louvre Museum" });
    expect(one(at("Louvre tickets"))[0]).toMatchObject({ kind: "activity", name: "Louvre" });
    const [show] = signalsOf([at("Hamilton", { location: "Richard Rodgers Theatre, 226 W 46th St, New York, NY 10036", description: "Ticketmaster order #123. Your tickets are ready." })]);
    expect(show).toMatchObject({ kind: "activity", name: "Hamilton", city: "New York", note: "Ticketmaster booking" });
  });

  it("leaves out viewings, campus tours and other kinds of ticket", () => {
    const events = [
      at("Apartment tour", { location: "123 Bedford Ave, Brooklyn, NY" }),
      at("Campus tour"),
      at("Product tour for Acme"),
      at("Jira ticket 4521"),
      at("Train tickets to Porto"),
      at("Tour de France"),
    ];
    expect(signalsOf(events)).toEqual([]);
  });
});

describe("calendarSignals: trips", () => {
  it("reads trips named after a place", () => {
    const trips = signalsOf([
      at("Trip to Lisbon", { id: "1" }),
      at("Porto trip", { id: "2" }),
      days("Vacation in Tulum", "2025-07-01", "2025-07-06", { id: "3" }),
      days("OOO - Seville", "2025-08-11", "2025-08-15", { id: "4" }),
      days("Spring break in Cancún", "2025-03-14", "2025-03-21", { id: "5" }),
    ]).map(brief);
    expect(trips).toEqual([
      { kind: "city", name: "Lisbon", city: "Lisbon", countryCode: "PT" },
      { kind: "city", name: "Porto", city: "Porto", countryCode: "PT" },
      { kind: "city", name: "Tulum", city: "Tulum", countryCode: "MX" },
      { kind: "city", name: "Seville", city: "Seville", countryCode: "ES" },
      { kind: "city", name: "Cancún", city: "Cancún", countryCode: "MX" },
    ]);
  });

  it("reads countries, US states and several places", () => {
    expect(one(days("Trip to Japan", "2025-04-01", "2025-04-10"))).toEqual([{ kind: "city", name: "Japan", city: null, countryCode: "JP" }]);
    expect(one(days("Hawaii trip", "2025-08-01", "2025-08-08"))).toEqual([{ kind: "city", name: "Hawaii", city: null, countryCode: "US" }]);
    const both = signalsOf([days("Trip to Lisbon & Porto", "2025-10-01", "2025-10-08", { id: "lp" })]);
    expect(both.map((s) => [s.name, s.ref])).toEqual([
      ["Lisbon", "cal:lp"],
      ["Porto", "cal:lp#2"],
    ]);
  });

  it("needs a flag or several days for an all-day event named only after a place", () => {
    expect(one(days("Lisbon 🇵🇹", "2025-10-01", "2025-10-06"))[0]).toMatchObject({ name: "Lisbon", countryCode: "PT" });
    expect(one(days("Honeymoon 🇵🇹", "2025-10-20", "2025-10-27"))).toEqual([{ kind: "city", name: "Portugal", city: null, countryCode: "PT" }]);
    expect(one(days("Wedding in Napa", "2025-10-10", "2025-10-13"))[0]).toMatchObject({ name: "Napa", countryCode: "US" });
    expect(signalsOf([days("Jordan", "2025-10-07", "2025-10-08"), days("Florence", "2025-10-09", "2025-10-10")])).toEqual([]);
  });

  it("only takes a place it doesn't know from a trip of a day or more", () => {
    expect(signalsOf([at("Trip to Hudson")])).toEqual([]);
    expect(one(days("Trip to Hudson", "2025-07-11", "2025-07-14"))).toEqual([{ kind: "city", name: "Hudson", city: "Hudson", countryCode: null }]);
  });

  it("leaves out work trips, errands and holidays", () => {
    const events = [
      days("Business trip to Chicago", "2025-09-01", "2025-09-03"),
      at("Costco trip"),
      days("Labor Day weekend", "2025-08-30", "2025-09-02"),
      days("Labor Day trip", "2025-08-30", "2025-09-02"),
      days("Bank Holiday", "2025-08-25", "2025-08-26"),
      days("Christmas Day", "2025-12-25", "2025-12-26"),
      days("Hanukkah", "2025-12-14", "2025-12-22"),
      days("Weekend in Hudson", "2025-07-11", "2025-07-14"),
    ];
    expect(signalsOf(events)).toEqual([]);
  });
});

describe("calendarSignals: what's left out", () => {
  it("ignores meetings, birthdays, appointments and to-dos", () => {
    const events = [
      at("Q3 planning sync", { location: "Conference Room 4B" }),
      at("Weekly 1:1 with Dana", { location: "Zoom" }),
      days("Mom's birthday", "2025-07-01", "2025-07-02"),
      days("Independence Day", "2025-07-04", "2025-07-05"),
      at("Dentist appointment"),
      at("Gym"),
      at("Book dinner at Carbone"),
      at("Pick up dry cleaning"),
      at("Interview with Orbital"),
    ];
    expect(signalsOf(events)).toEqual([]);
  });

  it("ignores repeating events however the calendar marks them", () => {
    const events = [
      at("Dinner at Carbone", { recurring: true }),
      // Google: one occurrence of a series
      at("Dinner at Lilia", { id: "work@example.com:7cbh8rpc10lrc0ckih9tafss99_20250610T230000Z" }),
      // A phone lists every occurrence under the series' id
      at("Coffee at Blue Bottle", { id: "phone-7", start: "2025-06-10T09:00:00" }),
      at("Coffee at Blue Bottle", { id: "phone-7", start: "2025-06-17T09:00:00" }),
    ];
    expect(signalsOf(events)).toEqual([]);
  });

  it("keeps an event listed twice at the same time once", () => {
    const signals = signalsOf([at("Dinner at Lilia", { id: "phone-9" }), at("Dinner at Lilia", { id: "phone-9" })]);
    expect(signals.map((s) => s.ref)).toEqual(["cal:phone-9"]);
  });
});

describe("calendarSignals: dates, refs and limits", () => {
  it("dates a phone's UTC times in the event's zone, and Google's offsets as written", () => {
    const signals = signalsOf([
      { id: "ny", summary: "Dinner at Via Carota", start: "2025-05-15T00:00:00.000Z", timeZone: "America/New_York" },
      { id: "tokyo", summary: "Dinner at Den", start: "2025-05-15T00:00:00.000Z", timeZone: "Asia/Tokyo" },
      { id: "google", summary: "Dinner at Lilia", start: "2025-05-14T20:00:00-04:00" },
      { id: "allday", summary: "Trip to Lisbon", start: "2025-05-14", end: "2025-05-18" },
    ]);
    expect(signals.map((s) => `${s.ref} ${s.date}`)).toEqual(["cal:ny 2025-05-14", "cal:tokyo 2025-05-15", "cal:google 2025-05-14", "cal:allday 2025-05-14"]);
  });

  it("reads a UTC time in this device's zone when the zone is missing or unknown", () => {
    const d = new Date("2025-05-15T00:00:00.000Z");
    const here = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const signals = signalsOf([
      { id: "a", summary: "Dinner at Carbone", start: "2025-05-15T00:00:00.000Z" },
      { id: "b", summary: "Dinner at Lilia", start: "2025-05-15T00:00:00.000Z", timeZone: "Not/AZone" },
    ]);
    expect(signals.map((s) => s.date)).toEqual([here, here]);
  });

  it("gives events without an id a stable ref, and merges one dinner from two calendars", () => {
    const ev = at("Dinner at Lilia");
    expect(signalsOf([ev])[0]?.ref).toBe(signalsOf([{ ...ev }])[0]?.ref);
    // The richer record (the one with the booking) is kept.
    const merged = signalsOf([at("Dinner at Lilia", { id: "phone-1" }), at("Reservation at Lilia", { id: "phone-2", description: "Resy · party of 2" })]);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ ref: "cal:phone-2", name: "Lilia", note: "Resy reservation" });
  });

  it("keeps every field within the schema's limits", () => {
    const name = "Restaurante Tradicional Português do Bairro Alto e da Mouraria, Casa de Fados e Petiscos"; // 88 characters
    const [s] = signalsOf([at(`Dinner at ${name}`, { id: "x".repeat(300) })]);
    expect(s!.name).toBe(name);
    expect(s!.ref.length).toBeLessThanOrEqual(200);
    expect(s!.ref.startsWith("cal:xxx")).toBe(true);
    // Longer than any real venue: a pasted note, not a name.
    expect(signalsOf([at(`Dinner at ${"Le Restaurant Extraordinairement Long ".repeat(4)}`)])).toEqual([]);
    const [clean] = signalsOf([at("Dinner at Car\u0000bone \uD83D")]);
    expect(clean!.name).toBe("Carbone");
  });

  it("caps the output", () => {
    const events = Array.from({ length: 6000 }, (_, i) => at(`Dinner at Restaurant ${i}`, { id: `r${i}` }));
    expect(calendarSignals(events, "ics")).toHaveLength(5000);
  });

  it("copes with anything a caller passes", () => {
    const junk = [null, 7, "x", {}, { summary: 12 }, { summary: "Dinner at Lilia", start: 5 }, { summary: "Dinner at Lilia", start: new Date("2025-06-10T19:00:00Z") }];
    expect(() => calendarSignals(junk as unknown as CalendarEventLike[], "ics")).not.toThrow();
    expect(calendarSignals(null as unknown as CalendarEventLike[], "ics")).toEqual([]);
  });
});

describe("guessKind", () => {
  it("reads names in many languages", () => {
    const kinds = Object.fromEntries(
      ["Park Hyatt Tokyo", "Café Museum", "Restaurant & Bar", "Hotel bar", "Rijksmuseum", "ラーメン一蘭", "Кофейня", "Ski resort", "Wine shop", "Pastéis de Belém", "Hilton Head Island", "Carbone"].map(
        (n) => [n, guessKind(n)],
      ),
    );
    expect(kinds).toEqual({
      "Park Hyatt Tokyo": "stay",
      "Café Museum": "coffee",
      "Restaurant & Bar": "food",
      "Hotel bar": "drink",
      Rijksmuseum: "sight",
      ラーメン一蘭: "food",
      Кофейня: "coffee",
      "Ski resort": "activity",
      "Wine shop": "shop",
      "Pastéis de Belém": "food",
      "Hilton Head Island": "sight",
      Carbone: "sight",
    });
  });

  it("lets category hints win over the name, skipping generic ones", () => {
    expect(guessKind("Tartine", ["Coffee Shop"])).toBe("coffee");
    expect(guessKind("The Hoxton", ["point_of_interest", "lodging"])).toBe("stay");
    expect(guessKind("Lisbon", ["City"])).toBe("city");
    expect(guessKind("Joe's Pizza", ["establishment"])).toBe("food");
    expect(guessKind("Joe's Pizza", [7 as unknown as string])).toBe("food");
  });
});

describe("dedupeSignals", () => {
  const base: TasteSignal = { source: "facebook", ref: "fb:1", kind: "coffee", name: "Café A Brasileira", city: "Lisbon", countryCode: "PT", lat: null, lng: null, date: null, rating: null, liked: null, note: null, url: null };

  it("merges the same source and ref, keeping the richer record and filling its gaps", () => {
    const a: TasteSignal = { ...base, date: "2019-06-21" };
    const b: TasteSignal = { ...base, rating: 5, lat: 38.7106, lng: -9.1424 };
    const [m, ...rest] = dedupeSignals([a, b]);
    expect(rest).toEqual([]);
    expect(m).toMatchObject({ ref: "fb:1", rating: 5, date: "2019-06-21", lat: 38.7106, lng: -9.1424 });
  });

  it("merges one place across sources despite accents, case and local city names", () => {
    const fromCalendar: TasteSignal = { ...base, source: "ics", ref: "cal:9", name: "Cafe a Brasileira", city: "Lisboa", countryCode: null, date: "2025-06-10", note: "Resy reservation" };
    const merged = dedupeSignals([base, fromCalendar]);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ source: "ics", note: "Resy reservation", countryCode: "PT" });
  });

  it("keeps different cities and city visits apart, in order, without changing the input", () => {
    const porto: TasteSignal = { ...base, ref: "fb:2", city: "Porto" };
    const city: TasteSignal = { ...base, ref: "fb:3", kind: "city", name: "Lisbon" };
    const town: TasteSignal = { ...base, ref: "fb:4", name: "Lisbon" };
    const input = [porto, base, city, town];
    const copy = structuredClone(input);
    expect(dedupeSignals(input).map((s) => s.ref)).toEqual(["fb:2", "fb:1", "fb:3", "fb:4"]);
    expect(input).toEqual(copy);
  });
});
