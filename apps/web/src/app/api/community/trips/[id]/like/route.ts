import { requireUser } from "@/lib/auth";
import { setLike } from "@/lib/community";
import { handler, json } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = handler(async (req: Request, { params }: { params: { id: string } }) =>
  json({ liked: true, likes: await setLike(await requireUser(req), params.id, true) }),
);
export const DELETE = handler(async (req: Request, { params }: { params: { id: string } }) =>
  json({ liked: false, likes: await setLike(await requireUser(req), params.id, false) }),
);
