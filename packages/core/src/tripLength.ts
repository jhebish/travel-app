/**
 * How long to stay: the number of days most travelers find right for a destination, and how the
 * trip someone planned compares. The question is asked once per destination and never mentions the
 * traveler's own choice, so the answer isn't bent toward whatever they picked.
 *
 * No zod here (the apps use it in the browser); TripLengthSchema in schemas.ts checks the answer.
 */

export interface TripLength {
  /** Enough to see the essentials without rushing. */
  min: number;
  /** Past this, more days add little for most people. */
  max: number;
  /** What those days cover, naming places: "Two days for the old town and Belém, a third for Sintra." */
  note: string;
}

export type LengthFit = "short" | "right" | "long";

export function lengthFit(days: number, ideal: Pick<TripLength, "min" | "max">): LengthFit {
  if (days < ideal.min) return "short";
  if (days > ideal.max) return "long";
  return "right";
}

const daysText = (n: number) => `${n} ${n === 1 ? "day" : "days"}`;

/** "3–4 days", or "1 day". */
export const rangeText = (t: Pick<TripLength, "min" | "max">) => (t.min === t.max ? daysText(t.min) : `${t.min}–${t.max} days`);

/** How the planned length compares, in a few words: "Your 2 days are tight for Lisbon." */
export function fitText(days: number, ideal: Pick<TripLength, "min" | "max">, place: string): string {
  const yours = days === 1 ? "Your 1 day is" : `Your ${days} days are`;
  switch (lengthFit(days, ideal)) {
    case "short":
      return `${yours} tight for ${place}.`;
    case "long":
      return `${yours} more than most people need, with room for day trips or a slower pace.`;
    default:
      return days === 1 ? "Your 1 day fits." : `Your ${days} days fit.`;
  }
}

export const TRIP_LENGTH_TOOL = {
  name: "submit_trip_length",
  description: "The number of days most travelers find right for the destination.",
  input_schema: {
    type: "object",
    properties: {
      min_days: { type: "integer", minimum: 1, maximum: 30, description: "Fewest days to see the essentials without rushing." },
      max_days: { type: "integer", minimum: 1, maximum: 45, description: "Where more days stop adding much for most people." },
      note: {
        type: "string",
        description: 'Under 140 characters: what those days cover, naming real places. E.g. "Two days for the old town and Belém, a third for Sintra."',
      },
    },
    required: ["min_days", "max_days", "note"],
  },
} as const;

/** The question for a destination. Deliberately silent on how long the traveler picked. */
export function buildTripLengthPrompt(destination: string, mode: "single" | "multi"): string {
  const trip =
    mode === "multi"
      ? `a trip with several stops around ${destination}, on the route most first-time visitors take (count the days spent moving between stops)`
      : `a first visit to ${destination}`;
  return [
    `How many days do most travelers need for ${trip}?`,
    "Give the range most people find right: min is enough to see the essentials without rushing; max is where more days stop adding much. Don't count the journey there.",
    "Be honest in both directions: a small town may need one day, a big country two weeks or more.",
    'Then a note under 140 characters on what those days cover, naming real places, e.g. "Two days for the old town and Belém, a third for Sintra." No superlatives, no filler.',
  ].join("\n");
}
