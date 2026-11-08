import { z } from "zod";
import { STOP_KINDS } from "./quality";
// Plain lists and limits live in labels.ts (no zod) so the browser can use them on their own.
import { PARTIES, AGE_BANDS, BUDGETS, PACES, ABOUT_OPTIONS, INTERESTS, TRIP_MODES, MAX_DAYS, MAX_PLACE_PHOTOS, PICK_CATEGORIES, type TripMode } from "./labels";
export { PARTIES, AGE_BANDS, BUDGETS, PACES, ABOUT_OPTIONS, INTERESTS, TRIP_MODES, MAX_DAYS, MAX_PLACE_PHOTOS, PICK_CATEGORIES, type TripMode } from "./labels";
import { SOURCE_IDS, STAY_PRICES, STAY_STYLES } from "./sources";

const sourceId = z.enum(SOURCE_IDS);

/** Map loose source labels from the model ("Local", "local_picks", "Press coverage") onto real ids. */
const SOURCE_ALIASES: [RegExp, (typeof SOURCE_IDS)[number]][] = [
  [/local/, "locals"],
  [/friend/, "friends"],
  [/host|concierge|airbnb/, "hosts"],
  [/press|editor|magazine|news|journal/, "press"],
  [/indie|blog|independent|newsletter/, "indie"],
  [/review|google|yelp|tripadvisor|rating/, "reviews"],
  [/guide|book|lonely|fodor|rick/, "guidebooks"],
  [/social|insta|tiktok|influenc/, "social"],
  [/sponsor|paid|ad\b/, "sponsored"],
];
const looseSource = z.preprocess((v) => {
  const s = String(v ?? "").trim().toLowerCase();
  if ((SOURCE_IDS as readonly string[]).includes(s)) return s;
  for (const [re, id] of SOURCE_ALIASES) if (re.test(s)) return id;
  return "guidebooks"; // unknown label: neutral, and grounding replaces it with the real origin when it can
}, sourceId);

/** Text the model might send as a number or leave out. */
const toText = (v: unknown) => (v == null ? undefined : typeof v === "number" || typeof v === "boolean" ? String(v) : v);
const looseId = z.preprocess(
  (v) => (v == null || v === "" ? null : String(v).replace(/^\[|\]$/g, "").trim() || null),
  z.string().nullable(),
).optional();
const weight = z.number().int().min(0).max(10);
export const WeightsSchema = z.record(sourceId, weight);


export const StaySchema = z.object({
  on: z.boolean(),
  styles: z.array(z.enum(STAY_STYLES)).max(5).default([]),
  price: z.enum(STAY_PRICES).default("$150–300"),
});
export type StayPrefs = z.infer<typeof StaySchema>;


export const TripRequestSchema = z.object({
  /** "single": one city or area. "multi": several stops inside a country or region. */
  mode: z.enum(TRIP_MODES).default("single"),
  destination: z.string().trim().min(2).max(120),
  days: z.number().int().min(1).max(14),
  startDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .nullable(),
  /** The month they travel (1–12) when there's no exact date yet, so stops and picks suit the season. */
  month: z.number().int().min(1).max(12).nullable().optional(),
  party: z.enum(PARTIES),
  age: z.enum(AGE_BANDS).optional().nullable(),
  about: z.array(z.enum(ABOUT_OPTIONS)).max(ABOUT_OPTIONS.length).default([]),
  budget: z.enum(BUDGETS),
  interests: z.array(z.enum(INTERESTS)).max(INTERESTS.length).default([]),
  /** With Nightlife: clubs and dancing too, out until late. Without it, a night out is drinks. */
  clubs: z.boolean().default(false),
  pace: z.enum(PACES),
  extra: z.string().trim().max(500).default(""),
  stay: StaySchema.default({ on: false, styles: [], price: "$150–300" }),
  /** Friends (handles) planning this trip together: their taste is blended in and they can edit it. */
  with: z.array(z.string().trim().toLowerCase().regex(/^[a-z0-9_]{3,24}$/)).max(7).default([]),
}).transform((r) => (r.days > MAX_DAYS[r.mode] ? { ...r, days: MAX_DAYS[r.mode] } : r));
export type TripRequest = z.infer<typeof TripRequestSchema>;

/** A Google Maps photo of a place: a resource name we turn into an image URL, plus its author for credit. */
export const PlacePhotoSchema = z.object({
  name: z.string().regex(/^places\/[A-Za-z0-9_-]+\/photos\/[A-Za-z0-9_-]+$/),
  w: z.number().int().positive().optional(),
  h: z.number().int().positive().optional(),
  by: z.string().max(120).optional(),
  byUrl: z.string().url().max(500).optional(),
});
export type PlacePhoto = z.infer<typeof PlacePhotoSchema>;


export const PlaceVerificationSchema = z.object({
  placeId: z.string(),
  photos: z.array(PlacePhotoSchema).max(MAX_PLACE_PHOTOS).optional().catch(undefined),
  mapsUrl: z.string().url().optional(),
  address: z.string().optional(),
  lat: z.number().optional(),
  lng: z.number().optional(),
  hours: z.array(z.string()).optional(),
  status: z.string().optional(),
  /** The place's own website and phone, from Google: for travelers now, and for booking later. */
  website: z.string().url().max(500).optional().catch(undefined),
  /** International format, e.g. "+351 22 208 8188": dials from anywhere. */
  phone: z.string().max(40).optional().catch(undefined),
});
export type PlaceVerification = z.infer<typeof PlaceVerificationSchema>;

/** Model-written text: trim to the limit instead of rejecting the whole plan. */
const clip = (max: number) => z.preprocess(toText, z.string().transform((v) => v.slice(0, max)));
const clipReq = (max: number) => z.preprocess(toText, z.string().trim().min(1).transform((v) => v.slice(0, max)));
const coord = (lim: number) => z.preprocess((v) => (typeof v === "string" ? Number(v) : v), z.number().min(-lim).max(lim)).nullable().optional().catch(undefined);

/**
 * A list of model-written items: keep the ones that validate and drop the rest,
 * so one malformed entry doesn't sink the whole plan. Fails only if fewer than `min` survive.
 */
export function salvage<T extends z.ZodTypeAny>(item: T, min = 0, max = 50) {
  return z
    .array(z.unknown())
    .transform((arr, ctx) => {
      const ok: z.output<T>[] = [];
      for (const raw of arr) {
        const r = item.safeParse(raw);
        if (r.success) ok.push(r.data);
      }
      if (ok.length < min) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `only ${ok.length} of ${arr.length} items were usable` });
        return z.NEVER;
      }
      return ok.slice(0, max);
    });
}

/** Why a bar or club counts as hot right now: the recent sources that say so (see nightlife.ts). */
export const HotNowSchema = z.object({
  sources: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(60),
        url: z.string().url().max(500).optional().catch(undefined),
        /** When it was published (YYYY-MM or YYYY-MM-DD), if known. */
        date: z.string().max(10).optional().catch(undefined),
      }),
    )
    .max(3),
});
export type HotNow = z.infer<typeof HotNowSchema>;

/** Whose pick it is, when it came from a friend who's been ("Sara's pick"). Set by the server, never the model. */
export const FriendPickSchema = z.object({
  name: z.string().trim().min(1).max(60),
  /** They live there, or have been three times or more. */
  local: z.boolean().optional(),
  /** How many other friends loved it too. */
  more: z.number().int().min(1).max(50).optional(),
});
export type FriendPick = z.infer<typeof FriendPickSchema>;

export const StopSchema = z.object({
  time: clip(20).default(""),
  name: clipReq(160),
  neighborhood: clip(120).default(""),
  why: clip(400).default(""),
  localTip: clip(400).default(""),
  /** What the stop is for (coffee, a meal, a sight…), from the model; the day check reads it. */
  kind: z.enum(STOP_KINDS).optional().catch(undefined),
  /** When the pick matches the traveler's taste: a few words on why ("Like Septime: natural wine"). */
  forYou: z.preprocess((v) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 100) : undefined), z.string().optional()).catch(undefined),
  /** What it costs, roughly, in local currency with US dollars: "EGP 700 entry (~$14)", "~€25 a head", "Free". */
  cost: z.preprocess((v) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 90) : undefined), z.string().optional()).catch(undefined),
  source: looseSource,
  candidateId: looseId,
  /** Where the pick really came from: a vetted local pick, a Places result, a friend, or the model's own knowledge. */
  origin: z.enum(["local_pick", "google", "ai", "friend"]).optional(),
  friend: FriendPickSchema.optional().catch(undefined),
  /** Approximate coordinates from the model; replaced by verified ones when Places finds the stop. */
  lat: coord(90),
  lng: coord(180),
  /** The traveler locked this stop: it survives day regeneration. */
  locked: z.boolean().optional().catch(undefined),
  place: PlaceVerificationSchema.optional(),
  /** A bar or club that recent sources call one of the places to go now (set by the server, never the model). */
  hot: HotNowSchema.optional().catch(undefined),
});
export type Stop = z.infer<typeof StopSchema>;

export const LiveRateSchema = z.object({
  provider: z.string(),
  nightlyUsd: z.number(),
  totalUsd: z.number(),
  checkin: z.string(),
  checkout: z.string(),
  fetchedAt: z.string(),
});

export const HotelSchema = z.object({
  name: clipReq(160),
  /** Multi-city trips: the stop this hotel is for. */
  city: clip(80).optional().catch(undefined),
  neighborhood: clip(120).default(""),
  style: clip(60).default(""),
  nightly: clip(40).default(""),
  why: clip(400).default(""),
  localTip: clip(400).default(""),
  forYou: z.preprocess((v) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 100) : undefined), z.string().optional()).catch(undefined),
  source: looseSource,
  candidateId: looseId,
  origin: z.enum(["local_pick", "google", "ai", "friend"]).optional(),
  friend: FriendPickSchema.optional().catch(undefined),
  expediaPropertyId: looseId,
  lat: coord(90),
  lng: coord(180),
  place: PlaceVerificationSchema.optional(),
  liveRate: LiveRateSchema.optional(),
});
export type Hotel = z.infer<typeof HotelSchema>;

export const DaySchema = z.object({
  label: clip(40).default(""),
  theme: clip(160).default(""),
  /** Multi-city trips: where this day happens. */
  city: clip(80).optional().catch(undefined),
  /** Multi-city trips: how you get here on the first day in a new place. */
  arrival: clip(240).optional().catch(undefined),
  stops: salvage(StopSchema, 1, 8),
});

const toInt = (v: unknown) => (typeof v === "string" && v.trim() !== "" ? Number(v) : v);

/** One stop on a multi-city route. */
export const RouteLegSchema = z.object({
  city: clipReq(80),
  region: clip(80).default(""),
  days: z.preprocess(toInt, z.number().int().min(1).max(14)),
  why: clip(300).default(""),
  /** What this stop is like in the travel month (or its best months when there's no date). */
  season: clip(140).optional().catch(undefined),
  /** Other stops that could take this one's place in the route: shown as swaps. */
  alternatives: salvage(z.object({ city: clipReq(80), why: clip(120).default("") }), 0, 4).optional().catch(undefined),
  /** How to get here from the previous stop (absent for the first stop). */
  transfer: z
    .object({ mode: clip(40).default(""), duration: clip(40).default(""), note: clip(200).default("") })
    .nullable()
    .optional()
    .catch(null),
  dayThemes: salvage(z.object({ theme: clip(160).default(""), area: clip(160).default("") }), 0, 14).default([]),
});
export type RouteLeg = z.infer<typeof RouteLegSchema>;

/** The days most travelers find right for the destination (tripLength.ts). A reversed range is put right. */
export const TripLengthSchema = z
  .object({
    min: z.preprocess(toInt, z.number().int().min(1).max(30)),
    max: z.preprocess(toInt, z.number().int().min(1).max(45)),
    note: clip(160).default(""),
  })
  .transform((t) => (t.max < t.min ? { ...t, min: t.max, max: t.min } : t));

export const ItinerarySchema = z.object({
  title: clipReq(140),
  /** How long most people stay: shown at the top of the trip against the days planned. */
  idealDays: TripLengthSchema.optional().catch(undefined),
  /** Older trips: a general description. No longer written or shown. */
  summary: clip(600).default(""),
  /**
   * Why this trip suits its owner, from their past trips, ratings and thumbs. Empty unless there's
   * something specific to say. Only the owner sees it.
   */
  forYou: clip(300).optional(),
  mode: z.enum(TRIP_MODES).optional().catch(undefined),
  /** Multi-city trips: the stops in order. */
  route: salvage(RouteLegSchema, 0, 8).optional(),
  // Up to two weeks (several stops) and two hotels per stop.
  days: salvage(DaySchema, 1, MAX_DAYS.multi),
  hotels: salvage(HotelSchema, 0, 16).default([]),
  notes: salvage(clip(300), 0, 6).default([]),
  stayLabel: z.string().optional(),
  /** Votes on stops the traveler swapped out, kept so the training signal isn't lost. */
  replaced: z.array(z.object({ source: sourceId, vote: z.union([z.literal(1), z.literal(-1)]) })).max(200).default([]),
});
export type Itinerary = z.infer<typeof ItinerarySchema>;

export const EditSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("swap"), day: z.number().int().min(0).max(MAX_DAYS.multi - 1), index: z.number().int().min(0).max(7), hint: z.string().trim().max(200).default("") }),
  z.object({ action: z.literal("regenerate_day"), day: z.number().int().min(0).max(MAX_DAYS.multi - 1), hint: z.string().trim().max(200).default("") }),
  z.object({ action: z.literal("lock"), day: z.number().int().min(0).max(MAX_DAYS.multi - 1), index: z.number().int().min(0).max(7), locked: z.boolean() }),
  /** Multi-city trips: replace one stop on the route with another town, and re-plan its days. */
  z.object({
    action: z.literal("swap_city"),
    leg: z.number().int().min(0).max(7),
    city: z
      .string()
      .trim()
      .min(2)
      .max(80)
      .regex(/^[^<>{}\[\]\n\r\t"]+$/, "Just the name of a town or city."),
  }),
]);
export type EditRequest = z.infer<typeof EditSchema>;

export const VotesSchema = z.record(
  z.string().regex(/^(\d+-\d+|h-\d+)$/),
  z.union([z.literal(1), z.literal(-1)]),
);

export const FeedbackPatchSchema = z
  .object({
    saved: z.boolean().optional(),
    rating: z.number().int().min(0).max(5).optional(),
    votes: VotesSchema.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "Nothing to update" });

export const PrefsSchema = z.object({
  useCustom: z.boolean(),
  weights: WeightsSchema,
  blocked: z.array(sourceId).default([]),
});
export type Prefs = z.infer<typeof PrefsSchema>;

export const AppConfigSchema = z.object({
  weights: WeightsSchema,
  blocked: z.array(sourceId).default([]),
  alwaysFeature: z.string().max(4000).default(""),
  neverRecommend: z.string().max(4000).default(""),
});
export type AppConfig = z.infer<typeof AppConfigSchema>;


export const LocalPickInputSchema = z.object({
  city: z.string().trim().min(2).max(120),
  name: z.string().trim().min(1).max(160),
  neighborhood: z.string().trim().max(120).optional().nullable(),
  category: z.enum(PICK_CATEGORIES),
  source: z.enum(["locals", "hosts", "press", "indie", "reviews", "guidebooks", "social"]).default("locals"),
  note: z.string().trim().max(600).optional().nullable(),
  tags: z.array(z.string().trim().max(40)).max(12).default([]),
  priceBand: z.enum(STAY_PRICES).optional().nullable(),
  stayStyle: z.enum(STAY_STYLES).optional().nullable(),
});
export type LocalPickInput = z.infer<typeof LocalPickInputSchema>;

export const LocalPickReviewSchema = z.object({
  status: z.enum(["pending", "approved", "rejected"]).optional(),
  expediaPropertyId: z.string().trim().max(40).optional().nullable(),
  source: z.enum(["locals", "hosts", "press", "indie", "reviews", "guidebooks", "social"]).optional(),
  note: z.string().trim().max(600).optional().nullable(),
});

/** Step 1 of the fast planner: the trip outline (no stops yet). */
export const OutlineSchema = z.object({
  title: clipReq(140),
  forYou: clip(300).default(""),
  notes: salvage(clip(300), 0, 6).default([]),
  days: salvage(
    z.object({
      label: clip(40).default(""),
      theme: clip(160).default(""),
      area: clip(160).default(""),
      candidateIds: salvage(z.preprocess(toText, z.string()), 0, 30).default([]),
      /** The destination's essential sights placed on this day; the day must include them. */
      mustSee: salvage(z.preprocess(toText, z.string().trim().min(1).max(120)), 0, 3).default([]),
    }),
    1,
    7,
  ),
});
