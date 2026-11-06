import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { follow } from "@/lib/community";
import { handler, json, parseBody } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({ handle: z.string().trim().min(3).max(24), follow: z.boolean() });

export const POST = handler(async (req: Request) => {
  const ctx = await requireUser(req);
  const b = await parseBody(req, Body);
  await follow(ctx, b.handle, b.follow);
  return json({ ok: true, following: b.follow });
});
