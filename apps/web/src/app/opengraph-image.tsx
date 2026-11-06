import { OG_SIZE, OG_TYPE, brandImage } from "@/lib/og";

// The brand card: the home page's preview, and the default for pages without their own.
export const runtime = "nodejs";
export const alt = "Pylos: Where to next? Trips planned the local way.";
export const size = OG_SIZE;
export const contentType = OG_TYPE;

export default function Image() {
  return brandImage();
}
