import { getCtx } from "@/lib/auth";
import { handler, json } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = handler(async (req: Request) => {
  const ctx = await getCtx(req);
  return json({ user: ctx.user ? { id: ctx.user.id, email: ctx.user.email } : null, role: ctx.role });
});
