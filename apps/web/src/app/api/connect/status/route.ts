import { requireUser } from "@/lib/auth";
import { PROVIDERS, configured } from "@/lib/connect";
import { handler, json } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Which accounts can be connected here, and when you last imported from each. */
export const GET = handler(async (req: Request) => {
  const ctx = await requireUser(req);
  const { data } = await ctx.db.from("connections").select("provider, last_import_at, items_found").eq("user_id", ctx.user.id);
  const rows = new Map((data ?? []).map((r) => [r.provider as string, r]));
  return json({
    providers: Object.fromEntries(
      PROVIDERS.map((p) => [p, { configured: configured(p), lastImportAt: rows.get(p)?.last_import_at ?? null, found: rows.get(p)?.items_found ?? 0 }]),
    ),
  });
});
