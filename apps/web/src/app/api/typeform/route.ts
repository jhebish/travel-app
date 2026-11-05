import { env } from "@/lib/env";
import { handler, json } from "@/lib/http";
import { typeformEnabled } from "@/lib/typeform";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Whether the Typeform intake is on, and which form to embed. */
export const GET = handler(async () => json({ formId: typeformEnabled() ? env.typeformFormId() : null }));
