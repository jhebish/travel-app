/**
 * Typeform intake: the form definition Pylos creates in your Typeform account, and the mapping
 * from a Typeform response back to a TripRequest.
 *
 * Every question and every choice carries a fixed `ref`, so answers are matched by ref, never by
 * wording: you can reword questions, reorder them or restyle the form in Typeform freely.
 * If a choice was added by hand without our ref, its label is matched loosely instead.
 */
import {
  ABOUT_OPTIONS,
  AGE_BANDS,
  BUDGETS,
  INTERESTS,
  PACES,
  PARTIES,
  MAX_DAYS,
  TripRequestSchema,
  type TripRequest,
} from "./schemas";
import { STAY_PRICES, STAY_STYLES } from "./sources";

export const TF = {
  tripType: "trip_type",
  destination: "destination",
  days: "days",
  startDate: "start_date",
  party: "party",
  age: "age",
  budget: "budget",
  interests: "interests",
  pace: "pace",
  about: "about",
  stayOn: "stay_on",
  stayStyles: "stay_styles",
  stayPrice: "stay_price",
  extra: "extra",
} as const;

/** Hidden field carrying the signed-in (or guest) user id, so a response can only build that user's trip. */
export const TF_HIDDEN_UID = "uid";

const slug = (v: string) =>
  v
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
const choiceRef = (field: string, value: string) => `${field}_${slug(value)}`;

/** First question: what kind of trip. "browse" ends the form and sends them to the Browse page. */
export const TF_TRIP_TYPES = ["one", "multi", "browse"] as const;
const TRIP_TYPE_LABELS: Record<(typeof TF_TRIP_TYPES)[number], string> = {
  one: "One place I have in mind",
  multi: "Several stops in a country or region",
  browse: "Not sure yet, show me what's trending",
};
export const TF_BROWSE_ENDING = "browse";

const PARTY_LABELS: Record<(typeof PARTIES)[number], string> = {
  Solo: "Just me",
  Couple: "As a couple",
  "Family with kids": "Family with kids",
  "Group of friends": "Group of friends",
};
const BUDGET_LABELS: Record<(typeof BUDGETS)[number], string> = {
  Budget: "Keep it cheap ($)",
  "Mid-range": "Mid-range ($$)",
  Splurge: "Splurge ($$$)",
};
const PACE_LABELS: Record<(typeof PACES)[number], string> = {
  Slow: "Slow: a few things, lots of lingering",
  Balanced: "Balanced",
  Packed: "Packed: see as much as we can",
};

function choices<T extends string>(field: string, values: readonly T[], labels?: Partial<Record<T, string>>) {
  return values.map((v) => ({ ref: choiceRef(field, v), label: labels?.[v] ?? v }));
}

function multiple<T extends string>(
  ref: string,
  title: string,
  values: readonly T[],
  opts: { multi?: boolean; required?: boolean; description?: string; labels?: Partial<Record<T, string>> } = {},
) {
  return {
    ref,
    title,
    type: "multiple_choice",
    properties: {
      ...(opts.description ? { description: opts.description } : {}),
      allow_multiple_selection: !!opts.multi,
      allow_other_choice: false,
      randomize: false,
      vertical_alignment: true,
      choices: choices(ref, values, opts.labels),
    },
    validations: { required: opts.required ?? true },
  };
}

/** The form Pylos creates through the Typeform Create API. */
export function typeformDefinition(opts: { title?: string; themeHref?: string; browseUrl?: string } = {}) {
  return {
    title: opts.title ?? "Pylos trip intake",
    ...(opts.themeHref ? { theme: { href: opts.themeHref } } : {}),
    hidden: [TF_HIDDEN_UID],
    settings: { language: "en", is_public: true, show_progress_bar: true, progress_bar: "proportion", meta: { allow_indexing: false } },
    welcome_screens: [
      {
        ref: "welcome",
        title: "Let's plan a trip the way locals would.",
        properties: { show_button: true, button_text: "Start", description: "A dozen quick questions. Takes about a minute." },
      },
    ],
    thankyou_screens: [
      {
        ref: "building",
        title: "Building your trip to {{field:destination}}…",
        properties: { show_button: false, share_icons: false, description: "Stay on this page. Your plan appears in a few seconds." },
      },
      {
        ref: TF_BROWSE_ENDING,
        title: "Let's find your next place.",
        properties: {
          show_button: true,
          button_text: "Explore trending destinations",
          share_icons: false,
          description: "Spin the globe, open sample itineraries, and plan when something catches your eye.",
          ...(opts.browseUrl ? { button_mode: "redirect", redirect_url: opts.browseUrl } : {}),
        },
      },
    ],
    fields: [
      multiple(TF.tripType, "What kind of trip is this?", TF_TRIP_TYPES, { labels: TRIP_TYPE_LABELS }),
      { ref: TF.destination, title: "Where are you headed?", type: "short_text", properties: { description: "A city (Lisbon, Oaxaca) or, for several stops, a country or region (Egypt, Sardinia)." }, validations: { required: true, max_length: 120 } },
      { ref: TF.days, title: "How many days in {{field:destination}}?", type: "number", properties: { description: "Up to 7 for one place, up to 14 for several stops." }, validations: { required: true, min_value: 1, max_value: 14 } },
      { ref: TF.startDate, title: "When do you arrive?", type: "date", properties: { description: "Optional. Lets us check live hotel rates.", structure: "MMDDYYYY", separator: "/" }, validations: { required: false } },
      multiple(TF.party, "Who's coming?", PARTIES, { labels: PARTY_LABELS }),
      multiple(TF.age, "Your age range?", AGE_BANDS),
      multiple(TF.budget, "What's the budget feel?", BUDGETS, { labels: BUDGET_LABELS }),
      multiple(TF.interests, "What are you into?", INTERESTS, { multi: true, required: false, description: "Pick as many as you like." }),
      multiple(TF.pace, "How full should each day be?", PACES, { labels: PACE_LABELS }),
      multiple(TF.about, "Anything we should plan around?", ABOUT_OPTIONS, {
        multi: true,
        required: false,
        description: "Optional and private to you. It only shapes your plan.",
      }),
      { ref: TF.stayOn, title: "Want us to suggest places to stay?", type: "yes_no", properties: { description: "Three hotels that fit the trip." }, validations: { required: true } },
      multiple(TF.stayStyles, "What kind of place?", STAY_STYLES, { multi: true, required: false }),
      multiple(TF.stayPrice, "Roughly how much per night?", STAY_PRICES),
      { ref: TF.extra, title: "Anything else we should know?", type: "long_text", properties: { description: "Anniversary trip, hate crowds, staying near the old town…" }, validations: { required: false, max_length: 500 } },
    ],
    logic: [
      {
        type: "field",
        ref: TF.tripType,
        actions: [
          {
            action: "jump",
            details: { to: { type: "thankyou", value: TF_BROWSE_ENDING } },
            condition: { op: "is", vars: [{ type: "field", value: TF.tripType }, { type: "choice", value: choiceRef(TF.tripType, "browse") }] },
          },
        ],
      },
      {
        type: "field",
        ref: TF.stayOn,
        actions: [
          {
            action: "jump",
            details: { to: { type: "field", value: TF.extra } },
            condition: { op: "is", vars: [{ type: "field", value: TF.stayOn }, { type: "constant", value: false }] },
          },
        ],
      },
    ],
  };
}

/** The parts of a Typeform answer we read (Responses API and webhooks share this shape). */
export interface TypeformAnswer {
  field: { id?: string; ref?: string; type?: string };
  type: string;
  text?: string;
  number?: number;
  date?: string;
  boolean?: boolean;
  choice?: { label?: string; ref?: string; other?: string };
  choices?: { labels?: string[]; refs?: string[]; ids?: string[]; other?: string };
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9+$]/g, "");

/** Match a choice to one of our values: by our ref first, then loosely by label. */
function pick<T extends string>(field: string, values: readonly T[], ref?: string, label?: string): T | undefined {
  if (ref) {
    const hit = values.find((v) => choiceRef(field, v) === ref);
    if (hit) return hit;
  }
  if (label) {
    const l = norm(label);
    const exact = values.find((v) => norm(v) === l);
    if (exact) return exact;
    // "Mid-range ($$)" → "Mid-range"; "Just me" → "Solo" via our own labels.
    return values.find((v) => l.includes(norm(v)) || norm(v).includes(l));
  }
  return undefined;
}

function pickLabelled<T extends string>(field: string, values: readonly T[], labels: Record<T, string> | undefined, ref?: string, label?: string) {
  const direct = pick(field, values, ref, label);
  if (direct || !label || !labels) return direct;
  const l = norm(label);
  return values.find((v) => norm(labels[v]) === l);
}

/**
 * Turn Typeform answers into a validated TripRequest. Missing optional answers get sensible
 * defaults; throws a plain-language Error if the destination or day count is missing.
 */
export function typeformToRequest(answers: TypeformAnswer[]): TripRequest {
  const by = new Map<string, TypeformAnswer>();
  for (const a of answers) if (a.field?.ref) by.set(a.field.ref, a);

  const one = <T extends string>(ref: string, values: readonly T[], labels?: Record<T, string>) => {
    const a = by.get(ref);
    return a?.choice ? pickLabelled(ref, values, labels, a.choice.ref, a.choice.label) : undefined;
  };
  const many = <T extends string>(ref: string, values: readonly T[]) => {
    const a = by.get(ref);
    if (!a?.choices) return [] as T[];
    const refs = a.choices.refs ?? [];
    const labels = a.choices.labels ?? [];
    const n = Math.max(refs.length, labels.length);
    const out = new Set<T>();
    for (let i = 0; i < n; i++) {
      const v = pick(ref, values, refs[i], labels[i]);
      if (v) out.add(v);
    }
    return [...out];
  };

  const destination = (by.get(TF.destination)?.text ?? "").trim();
  if (destination.length < 2) throw new Error("The form didn't include a destination.");
  const mode = one(TF.tripType, TF_TRIP_TYPES, TRIP_TYPE_LABELS) === "multi" ? "multi" : "single";
  const rawDays = by.get(TF.days)?.number;
  const days = Math.min(MAX_DAYS[mode], Math.max(1, Math.round(Number.isFinite(rawDays) ? rawDays! : 3)));
  const date = by.get(TF.startDate)?.date?.slice(0, 10);
  const stayOn = by.get(TF.stayOn)?.boolean ?? false;

  return TripRequestSchema.parse({
    mode,
    destination: destination.slice(0, 120),
    days,
    startDate: date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null,
    party: one(TF.party, PARTIES, PARTY_LABELS) ?? "Couple",
    age: one(TF.age, AGE_BANDS) ?? null,
    about: many(TF.about, ABOUT_OPTIONS),
    budget: one(TF.budget, BUDGETS, BUDGET_LABELS) ?? "Mid-range",
    interests: many(TF.interests, INTERESTS),
    pace: one(TF.pace, PACES, PACE_LABELS) ?? "Balanced",
    extra: (by.get(TF.extra)?.text ?? "").trim().slice(0, 500),
    stay: {
      on: stayOn,
      styles: stayOn ? many(TF.stayStyles, STAY_STYLES) : [],
      price: (stayOn && one(TF.stayPrice, STAY_PRICES)) || "$150–300",
    },
  });
}

/** Did the traveler pick "not sure yet"? Then they should go to the Browse page, not get a trip. */
export function typeformWantsBrowse(answers: TypeformAnswer[]): boolean {
  const a = answers.find((x) => x.field?.ref === TF.tripType);
  if (!a?.choice) return false;
  return a.choice.ref === choiceRef(TF.tripType, "browse") || /not sure|trending|inspire/i.test(a.choice.label ?? "");
}
