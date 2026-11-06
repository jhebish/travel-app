import { getCtx } from "@/lib/auth";
import { env } from "@/lib/env";
import { HttpError, handler, json } from "@/lib/http";
import { createIntakeForm } from "@/lib/typeform";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * One-time setup: create the intake form in the connected Typeform account.
 * Open while no form is configured; after TYPEFORM_FORM_ID is set, only admins can create another.
 */
export const POST = handler(async (req: Request) => {
  if (!env.typeformToken()) throw new HttpError(400, "Add TYPEFORM_TOKEN in Vercel first, then redeploy.", "typeform_off");
  if (env.typeformFormId()) {
    const ctx = await getCtx(req);
    if (ctx.role !== "admin") throw new HttpError(409, "A Typeform intake is already configured.", "typeform_exists");
  }
  const form = await createIntakeForm(`${new URL(req.url).origin}/browse`);
  return json({ ...form, next: `Set TYPEFORM_FORM_ID=${form.formId} in Vercel and redeploy.` }, 201);
});
