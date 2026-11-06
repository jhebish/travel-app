import { getCtx } from "@/lib/auth";
import { env } from "@/lib/env";
import { HttpError, handler, json } from "@/lib/http";
import { supabaseAdmin } from "@/lib/supabase/server";
import { createIntakeForm } from "@/lib/typeform";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * One-time setup: create the intake form in the connected Typeform account.
 * Open while no form is configured; after TYPEFORM_FORM_ID is set, only admins can create another.
 */
export const POST = handler(async (req: Request) => {
  if (!env.typeformToken()) throw new HttpError(400, "Add TYPEFORM_TOKEN in Vercel first, then redeploy.", "typeform_off");
  const ctx = await getCtx(req);
  const admin = ctx.role === "admin";
  if (env.typeformFormId() && !admin) throw new HttpError(409, "A Typeform intake is already configured.", "typeform_exists");
  // Only one form is ever created this way (admins can make another), so the endpoint can't be
  // used to fill the Typeform account with forms.
  const db = supabaseAdmin();
  const { error: claimErr } = await db.from("app_flags").insert({ key: "typeform_form", value: "creating" });
  if (claimErr && !admin) {
    const { data } = await db.from("app_flags").select("value").eq("key", "typeform_form").maybeSingle();
    throw new HttpError(409, data?.value && data.value !== "creating" ? `The intake form was already created: ${data.value}. Set TYPEFORM_FORM_ID to it.` : "The intake form is already being created.", "typeform_exists");
  }
  try {
    const form = await createIntakeForm(`${new URL(req.url).origin}/`);
    await db.from("app_flags").upsert({ key: "typeform_form", value: form.formId });
    return json({ ...form, next: `Set TYPEFORM_FORM_ID=${form.formId} in Vercel and redeploy.` }, 201);
  } catch (e) {
    await db.from("app_flags").delete().eq("key", "typeform_form").eq("value", "creating");
    throw e;
  }
});
