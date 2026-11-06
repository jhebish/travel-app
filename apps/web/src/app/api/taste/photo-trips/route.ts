import { PastTripInputSchema, cityKey, isCountryCode, type PastTripInput } from "@travel/core";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { callTool } from "@/lib/claude";
import { addPlacesBulk } from "@/lib/community";
import { HttpError, handler, json, parseBody } from "@/lib/http";
import { rateLimit } from "@/lib/tripAccess";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
/**
 * One stretch of days away from home, worked out on the phone from where photos were taken.
 * Only the rough centre (about 1 km) and the dates leave the phone, never the photos.
 */
const Stay = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  start: day,
  end: day,
  days: z.number().int().min(1).max(365),
});

const NAME_TOOL = {
  name: "name_places",
  description: "Name the town or city for each numbered point.",
  input_schema: {
    type: "object",
    properties: {
      places: {
        type: "array",
        items: {
          type: "object",
          properties: {
            i: { type: "integer" },
            city: { type: "string", description: "The town, city, island or resort area a traveler would say they visited." },
            countryCode: { type: "string", description: "ISO 3166-1 alpha-2, e.g. \"PT\"." },
          },
          required: ["i", "city", "countryCode"],
        },
      },
    },
    required: ["places"],
  },
} as const;
const Named = z.object({
  places: z.array(z.object({ i: z.number().int(), city: z.string().trim().min(1).max(80), countryCode: z.string().trim().toUpperCase() })).max(200),
});

async function nameAll(stays: z.infer<typeof Stay>[]) {
  const names = new Map<number, { city: string; countryCode: string }>();
  const chunks = Array.from({ length: Math.ceil(stays.length / 100) }, (_, c) => stays.slice(c * 100, c * 100 + 100).map((s, k) => ({ i: c * 100 + k, s })));
  await Promise.all(
    chunks.map(async (chunk) => {
      const prompt = `For each numbered point (latitude, longitude), name the place a traveler would say they visited: the town or city it's in or nearest to, or the island or resort area when that's what people call it (e.g. "Santorini", "Tulum", "Lake Como"). Give the country code too. If a point is at sea or you can't tell, skip it.

${chunk.map(({ i, s }) => `${i}: ${s.lat.toFixed(3)}, ${s.lng.toFixed(3)}`).join("\n")}

Call name_places.`;
      // The main model: it places coordinates more precisely (the fast one named Como "Lecco").
      const { input } = await callTool(prompt, NAME_TOOL, 4000);
      const parsed = Named.safeParse(input);
      if (!parsed.success) return;
      for (const p of parsed.data.places) if (isCountryCode(p.countryCode)) names.set(p.i, { city: p.city, countryCode: p.countryCode });
    }),
  );
  return names;
}

/** The phone found trips in your photos: name the places and add them to Places you've been. */
export const POST = handler(async (req: Request) => {
  const ctx = await requireUser(req);
  const { stays } = await parseBody(req, z.object({ stays: z.array(Stay).min(1).max(300) }));
  await rateLimit(ctx, "extract", 20, "That's a lot of scans this hour. Try again a little later.");
  const names = await nameAll(stays);
  if (!names.size) throw new HttpError(502, "We couldn't name those places just now. Try again.", "bad_output");

  // One trip per city and year: days add up across visits.
  const by = new Map<string, PastTripInput>();
  stays.forEach((s, i) => {
    const n = names.get(i);
    if (!n) return;
    const year = Number(s.start.slice(0, 4));
    const key = `${cityKey(n.city)}|${year}`;
    const had = by.get(key);
    if (had) had.days = Math.min(365, (had.days ?? 0) + s.days);
    else {
      const t = PastTripInputSchema.safeParse({ city: n.city, countryCode: n.countryCode, year, month: Number(s.start.slice(5, 7)), days: s.days });
      if (t.success) by.set(key, t.data);
    }
  });
  const trips = [...by.values()].sort((a, b) => (b.year ?? 0) - (a.year ?? 0)).slice(0, 100);
  const result = trips.length ? await addPlacesBulk(ctx, trips) : { added: 0, skipped: 0 };
  return json({ ...result, trips: trips.map(({ city, countryCode, year, month, days }) => ({ city, countryCode, year, month, days })) }, 201);
});
