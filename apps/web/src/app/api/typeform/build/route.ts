import { TF_HIDDEN_UID, typeformToRequest } from "@travel/core";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { env } from "@/lib/env";
import { HttpError, handler, parseBody } from "@/lib/http";
import { clientIp } from "@/lib/ip";
import { generateTrip } from "@/lib/pipeline";
import { ndjsonResponse } from "@/lib/stream";
import { fetchResponse } from "@/lib/typeform";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const Body = z.object({ responseId: z.string().trim().min(4).max(100).regex(/^[A-Za-z0-9_-]+$/) });

/**
 * Build a trip from a submitted Typeform response. Streams the same progress events as
 * POST /api/trips, starting with `{type:"request"}` once the answers are read.
 */
export const POST = handler(async (req: Request) => {
  const ctx = await requireUser(req);
  const { responseId } = await parseBody(req, Body);
  const opts = { ip: clientIp(req), tripsPerHour: env.tripsPerHour() };

  return ndjsonResponse(async (send) => {
    send({ type: "progress", pct: 1, label: "Reading your answers" });
    const response = await fetchResponse(responseId);
    // The embed passes the user's id as a hidden field; only that user can build from this response.
    if (response.hidden?.[TF_HIDDEN_UID] !== ctx.user.id) {
      throw new HttpError(403, "These answers belong to a different session. Fill in the form again.", "typeform_owner");
    }
    let request;
    try {
      request = typeformToRequest(response.answers ?? []);
    } catch (e) {
      throw new HttpError(400, (e as Error).message || "Some answers couldn't be read.", "typeform_answers");
    }
    send({ type: "request", request });
    return generateTrip(ctx, request, opts, send);
  });
});
