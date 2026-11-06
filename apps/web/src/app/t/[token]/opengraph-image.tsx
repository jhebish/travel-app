import { OG_SIZE, OG_TYPE, sharedTripImage } from "@/lib/og";

// Drawn per request (trips get edited); the response is cached for an hour (see lib/og.tsx).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const alt = "A trip plan shared from Pylos";
export const size = OG_SIZE;
export const contentType = OG_TYPE;

export default function Image({ params }: { params: { token: string } }) {
  return sharedTripImage(params.token);
}
