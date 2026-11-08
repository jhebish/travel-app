import { pairKey } from "@travel/core";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { HttpError, handler, isUuid, json, parseBody } from "@/lib/http";
import { cleanSkips, getOwnRank, voteOwn, type OwnKind } from "@/lib/rank";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const kindOf = (v: string | null): OwnKind => (v === "trip" ? "trip" : "place");
const uuid = z.string().refine(isUuid);

/**
 * "Which did you love more?" for your own places (?kind=place, the default) or past trips
 * (?kind=trip); ?trip=<past trip id> keeps to the places of one trip. ?skip=<pair>,<pair> leaves
 * out pairs you couldn't decide on. Returns the next pair and your ranking so far.
 */
export const GET = handler(async (req: Request) => {
  const ctx = await requireUser(req);
  const q = new URL(req.url).searchParams;
  const trip = q.get("trip");
  return json(await getOwnRank(ctx, kindOf(q.get("kind")), trip || null, cleanSkips((q.get("skip") ?? "").split(","))));
});

const Body = z
  .object({
    kind: z.enum(["trip", "place"]).default("place"),
    trip: uuid.nullable().optional(),
    /** The one you loved more, and the other one. */
    winner: uuid.optional(),
    loser: uuid.optional(),
    /** "Can't decide": nothing is saved, and this pair is left out for the rest of the session. */
    skip: z.tuple([uuid, uuid]).optional(),
    /** Pairs skipped earlier this session. */
    skipped: z.array(z.string().max(80)).max(60).default([]),
  })
  .refine((b) => (b.winner && b.loser) || b.skip, "A choice or a skip");

/** Record an answer (or a skip) and get the next pair. */
export const POST = handler(async (req: Request) => {
  const ctx = await requireUser(req);
  const b = await parseBody(req, Body);
  const skipped = cleanSkips([...b.skipped, ...(b.skip ? [pairKey(b.skip[0], b.skip[1])] : [])]);
  if (b.winner && b.loser) return json(await voteOwn(ctx, b.kind, b.trip ?? null, b.winner, b.loser, skipped));
  if (!b.skip) throw new HttpError(400, "Pick one of the two.");
  return json(await getOwnRank(ctx, b.kind, b.trip ?? null, skipped));
});
