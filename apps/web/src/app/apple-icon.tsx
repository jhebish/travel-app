import { ICON_SIZE, OG_TYPE, appleIconImage } from "@/lib/og";

// Home-screen icon, and the site icon message apps show beside a link.
export const runtime = "nodejs";
export const size = ICON_SIZE;
export const contentType = OG_TYPE;

export default function AppleIcon() {
  return appleIconImage();
}
