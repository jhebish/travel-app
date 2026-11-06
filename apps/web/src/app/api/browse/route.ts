import { NextResponse } from "next/server";
import { listBrowse } from "@/lib/browse";
import { handler } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Featured destinations, hottest first. Public and the same for everyone, so the CDN can cache it. */
export const GET = handler(async () => {
  const data = await listBrowse();
  return NextResponse.json(data, { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=900" } });
});
