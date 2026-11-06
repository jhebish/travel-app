import { ensureSample } from "@/lib/browse";
import { handler, json } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Plan the destination's sample itinerary if it doesn't exist yet (once, for everyone).
 * Returns the sample, or a status to poll on.
 */
export const POST = handler(async (_req: Request, { params }: { params: { key: string } }) => json({ sample: await ensureSample(params.key) }));
