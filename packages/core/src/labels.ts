/**
 * Plain lists, labels and limits: the planner's choices, the kinds of places someone has been to,
 * and where those came from. Nothing here imports zod, so pages in the browser can use these
 * without downloading it (the schemas in schemas.ts, taste.ts and picks.ts re-export them).
 */

export const PARTIES = ["Solo", "Couple", "Family with kids", "Group of friends"] as const;
export const AGE_BANDS = ["18–24", "25–34", "35–49", "50–64", "65+"] as const;
export const BUDGETS = ["Budget", "Mid-range", "Splurge"] as const;
export const PACES = ["Slow", "Balanced", "Packed"] as const;
export const ABOUT_OPTIONS = [
  "LGBTQ+ traveler",
  "Eats halal",
  "Vegetarian",
  "Doesn't drink alcohol",
  "Needs step-free access",
  "First time visiting",
  "Has been before",
] as const;
export const INTERESTS = [
  "Food",
  "Nightlife",
  "Art & design",
  "History",
  "Nature & outdoors",
  "Markets & shopping",
  "Live music",
  "Wellness",
] as const;

export const TRIP_MODES = ["single", "multi"] as const;
export type TripMode = (typeof TRIP_MODES)[number];
/** Longest trip for each mode. One place: a week. Several stops: two weeks. */
export const MAX_DAYS: Record<TripMode, number> = { single: 7, multi: 14 };

/** Up to Google's ten photos of a place: the first on the card, the rest in its gallery. */
export const MAX_PLACE_PHOTOS = 10;

export const PICK_CATEGORIES = ["food", "drink", "culture", "outdoors", "shopping", "nightlife", "stay", "other"] as const;

export const SIGNAL_KINDS = ["stay", "food", "drink", "coffee", "nightlife", "sight", "activity", "shop", "city"] as const;
export type SignalKind = (typeof SIGNAL_KINDS)[number];
export const SIGNAL_KIND_LABELS: Record<SignalKind, string> = {
  stay: "Stayed",
  food: "Ate",
  drink: "Drinks",
  coffee: "Coffee",
  nightlife: "Night out",
  sight: "Saw",
  activity: "Did",
  shop: "Shopped",
  city: "Visited",
};

/**
 * Where a signal came from. New ones only come from typing them in, signing in (Google Calendar,
 * Gmail, Facebook) or allowing the phone's calendar ("ics"). The others are kept for places saved by
 * earlier file imports; the database accepts the same list.
 */
export const SIGNAL_SOURCES = [
  "manual", // typed into Pylos
  "google_calendar", // signed-in Google Calendar (trips, hotel stays, dinner reservations)
  "ics", // the calendars on the person's phone, read in the app with their permission
  "google_takeout", // earlier imports only
  "instagram", // earlier imports only
  "facebook", // signed-in Facebook (check-ins, tagged places)
  "swarm", // earlier imports only
  "paste", // earlier imports only
  "gmail", // signed-in Gmail (hotel, flight, restaurant and tour confirmations)
] as const;
export type SignalSource = (typeof SIGNAL_SOURCES)[number];
export const SIGNAL_SOURCE_LABELS: Record<SignalSource, string> = {
  manual: "Added by you",
  google_calendar: "Google Calendar",
  ics: "Phone calendar",
  google_takeout: "Google Maps",
  instagram: "Instagram",
  facebook: "Facebook",
  swarm: "Swarm",
  paste: "Pasted list",
  gmail: "Gmail",
};

/**
 * Quick trip logging: the kinds of place a city's list offers, and how they're grouped on screen.
 */
export const PICK_KINDS = ["stay", "food", "drink", "coffee", "nightlife", "sight", "activity", "shop"] as const satisfies readonly SignalKind[];
export type PickKind = (typeof PICK_KINDS)[number];

/** How the list is grouped on screen, in order. */
export const PICK_GROUPS: { label: string; kinds: PickKind[] }[] = [
  { label: "Where you stayed", kinds: ["stay"] },
  { label: "Where you ate", kinds: ["food"] },
  { label: "Drinks and coffee", kinds: ["drink", "coffee", "nightlife"] },
  { label: "What you saw and did", kinds: ["sight", "activity", "shop"] },
];
