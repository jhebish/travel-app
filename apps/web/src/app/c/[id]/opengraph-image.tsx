import { OG_SIZE, OG_TYPE, communityTripImage } from "@/lib/og";

// Public trips only. Drawn per request (trips get edited); cached for an hour (see lib/og.tsx).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const alt = "A trip plan on Pylos";
export const size = OG_SIZE;
export const contentType = OG_TYPE;

export default function Image({ params }: { params: { id: string } }) {
  return communityTripImage(params.id);
}
