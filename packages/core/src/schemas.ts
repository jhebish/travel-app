import { z } from "zod";
import { SOURCE_IDS, STAY_PRICES, STAY_STYLES } from "./sources";

const sourceId = z.enum(SOURCE_IDS);
const weight = z.number().int().min(0).max(10);
export const WeightsSchema = z.record(sourceId, weight);

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

export const StaySchema = z.object({
  on: z.boolean(),
  styles: z.array(z.enum(STAY_STYLES)).max(5).default([]),
  price: z.enum(STAY_PRICES).default("$150–300"),
});
export type StayPrefs = z.infer<typeof StaySchema>;

export const TripRequestSchema = z.object({
  destination: z.string().trim().min(2).max(120),
  days: z.number().int().min(1).max(7),
  startDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .nullable(),
  party: z.enum(PARTIES),
  age: z.enum(AGE_BANDS).optional().nullable(),
  about: z.array(z.enum(ABOUT_OPTIONS)).max(ABOUT_OPTIONS.length).default([]),
  budget: z.enum(BUDGETS),
  interests: z.array(z.enum(INTERESTS)).max(INTERESTS.length).default([]),
  pace: z.enum(PACES),
  extra: z.string().trim().max(500).default(""),
  stay: StaySchema.default({ on: false, styles: [], price: "$150–300" }),
});
export type TripRequest = z.infer<typeof TripRequestSchema>;

export const PlaceVerificationSchema = z.object({
  placeId: z.string(),
  mapsUrl: z.string().url().optional(),
  address: z.string().optional(),
  lat: z.number().optional(),
  lng: z.number().optional(),
  hours: z.array(z.string()).optional(),
  status: z.string().optional(),
});
export type PlaceVerification = z.infer<typeof PlaceVerificationSchema>;

export const StopSchema = z.object({
  time: z.string().max(20),
  name: z.string().min(1).max(160),
  neighborhood: z.string().max(120).default(""),
  why: z.string().max(400),
  localTip: z.string().max(400).default(""),
  source: sourceId,
  candidateId: z.string().nullable().optional(),
  /** Where the pick really came from: a vetted local pick, a Places result, or the model's own knowledge. */
  origin: z.enum(["local_pick", "google", "ai"]).optional(),
  /** Approximate coordinates from the model; replaced by verified ones when Places finds the stop. */
  lat: z.number().min(-90).max(90).nullable().optional(),
  lng: z.number().min(-180).max(180).nullable().optional(),
  /** The traveler locked this stop: it survives day regeneration. */
  locked: z.boolean().optional(),
  place: PlaceVerificationSchema.optional(),
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
  name: z.string().min(1).max(160),
  neighborhood: z.string().max(120).default(""),
  style: z.string().max(60).default(""),
  nightly: z.string().max(40).default(""),
  why: z.string().max(400),
  localTip: z.string().max(400).default(""),
  source: sourceId,
  candidateId: z.string().nullable().optional(),
  origin: z.enum(["local_pick", "google", "ai"]).optional(),
  expediaPropertyId: z.string().nullable().optional(),
  lat: z.number().min(-90).max(90).nullable().optional(),
  lng: z.number().min(-180).max(180).nullable().optional(),
  place: PlaceVerificationSchema.optional(),
  liveRate: LiveRateSchema.optional(),
});
export type Hotel = z.infer<typeof HotelSchema>;

export const DaySchema = z.object({
  label: z.string().max(40),
  theme: z.string().max(160),
  stops: z.array(StopSchema).min(1).max(8),
});

export const ItinerarySchema = z.object({
  title: z.string().min(1).max(140),
  summary: z.string().max(600),
  days: z.array(DaySchema).min(1).max(7),
  hotels: z.array(HotelSchema).max(5).default([]),
  notes: z.array(z.string().max(300)).max(6).default([]),
  stayLabel: z.string().optional(),
  /** Votes on stops the traveler swapped out, kept so the training signal isn't lost. */
  replaced: z.array(z.object({ source: sourceId, vote: z.union([z.literal(1), z.literal(-1)]) })).max(200).default([]),
});
export type Itinerary = z.infer<typeof ItinerarySchema>;

export const EditSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("swap"), day: z.number().int().min(0).max(6), index: z.number().int().min(0).max(7), hint: z.string().trim().max(200).default("") }),
  z.object({ action: z.literal("regenerate_day"), day: z.number().int().min(0).max(6), hint: z.string().trim().max(200).default("") }),
  z.object({ action: z.literal("lock"), day: z.number().int().min(0).max(6), index: z.number().int().min(0).max(7), locked: z.boolean() }),
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

export const PICK_CATEGORIES = ["food", "drink", "culture", "outdoors", "shopping", "nightlife", "stay", "other"] as const;

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
