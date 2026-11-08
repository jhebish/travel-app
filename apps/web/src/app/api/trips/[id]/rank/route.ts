import { pairKey } from "@travel/core";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { HttpError, handler, json, parseBody } from "@/lib/http";
import { cleanSkips, getTripRank, voteTrip } from "@/lib/rank";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type P = { params: { id: string } };

const item = z.string().regex(/^([0-9]{1,2}-[0-9]{1,2}|h-[0-9]{1,2})$/);

/**
 * After a trip: the next two of its stops or hotels for you to compare, and the favourites of
 * everyone on it. For the trip's owner and friends planning it with them.
 */
export const GET = handler(async (req: Request, { params }: P) => {
  const ctx = await requireUser(req);
  const skip = cleanSkips((new URL(req.url).searchParams.get("skip") ?? "").split(","));
  return json(await getTripRank(ctx, params.id, skip));
});

const Body = z
  .object({
    winner: item.optional(),
    loser: item.optional(),
    skip: z.tuple([item, item]).optional(),
    skipped: z.array(z.string().max(16)).max(60).default([]),
  })
  .refine((b) => (b.winner && b.loser) || b.skip, "A choice or a skip");

/** Record "I loved this one more" (or "Can't decide") and get the next pair. */
export const POST = handler(async (req: Request, { params }: P) => {
  const ctx = await requireUser(req);
  const b = await parseBody(req, Body);
  const skipped = cleanSkips([...b.skipped, ...(b.skip ? [pairKey(b.skip[0], b.skip[1])] : [])]);
  if (b.winner && b.loser) return json(await voteTrip(ctx, params.id, b.winner, b.loser, skipped));
  if (!b.skip) throw new HttpError(400, "Pick one of the two.");
  return json(await getTripRank(ctx, params.id, skipped));
});
