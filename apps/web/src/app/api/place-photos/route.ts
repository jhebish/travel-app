import { NextResponse } from "next/server";
import { placePhotos } from "@/lib/places";

export const runtime = "nodejs";

/**
 * All of a place's photos (up to ten) for its gallery: /api/place-photos?id=<Google place id>.
 * Only needed for trips built before galleries, which kept a few. Cached by place for two weeks
 * in the database and a day at the edge.
 */
export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!/^[A-Za-z0-9_-]{10,300}$/.test(id)) return NextResponse.json({ photos: [] }, { status: 400 });
  const photos = await placePhotos(id);
  return NextResponse.json({ photos }, { headers: { "Cache-Control": "public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400" } });
}
