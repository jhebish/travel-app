import { NextResponse } from "next/server";
import { freshPhotoName, photoUrl, photosEnabled } from "@/lib/places";

export const runtime = "nodejs";

const REF = /^places\/([A-Za-z0-9_-]+)\/photos\/[A-Za-z0-9_-]+$/;
const WIDTHS = [160, 400, 800, 1200];

/**
 * A place photo: /api/photo?ref=places/<id>/photos/<ref>&w=400 redirects to Google's image.
 * The redirect is cached at the edge for a week, so each photo and size is fetched from Google
 * about once a week however many people look at it. Expired photo names fall back to a fresh
 * photo of the same place.
 *
 * Only the canonical link (exactly ?ref=…&w=<one of WIDTHS>, as the apps write it) is ever looked
 * up. Anything else (another width, extra or repeated parameters) is first redirected to it: the
 * edge caches every distinct URL separately, so `w=401`, `w=402`, … would otherwise each be a new,
 * paid request to Google.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const ref = url.searchParams.get("ref") ?? "";
  const m = REF.exec(ref);
  if (!m) return new NextResponse(null, { status: 404 });
  const want = Number(url.searchParams.get("w")) || 400;
  const width = WIDTHS.find((w) => w >= want) ?? 1200;
  const canonical = `?${new URLSearchParams({ ref, w: String(width) })}`;
  // The same link with plain slashes is accepted too, so a proxy that decodes %2F can't cause a loop.
  if (url.search !== canonical && url.search !== `?ref=${ref}&w=${width}`) {
    return NextResponse.redirect(new URL(`${url.pathname}${canonical}`, url.origin), {
      status: 308,
      headers: { "Cache-Control": "public, max-age=86400, s-maxage=604800" },
    });
  }
  if (!photosEnabled()) return new NextResponse(null, { status: 404 });
  let target = await photoUrl(ref, width);
  if (!target) {
    const fresh = await freshPhotoName(m[1]!);
    if (fresh) target = await photoUrl(fresh, width);
  }
  if (!target) return new NextResponse(null, { status: 404, headers: { "Cache-Control": "public, s-maxage=3600" } });
  return NextResponse.redirect(target, {
    status: 302,
    headers: { "Cache-Control": "public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400" },
  });
}
