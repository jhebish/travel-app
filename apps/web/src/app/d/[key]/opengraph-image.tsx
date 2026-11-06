import { DESTINATIONS } from "@travel/core";
import { OG_SIZE, OG_TYPE, destinationImage } from "@/lib/og";

export const runtime = "nodejs";
export const alt = "A Pylos destination, with a sample trip";
export const size = OG_SIZE;
export const contentType = OG_TYPE;

/** Destinations are a fixed list, so every card is drawn at build time. */
export function generateStaticParams() {
  return DESTINATIONS.map((d) => ({ key: d.key }));
}

export default function Image({ params }: { params: { key: string } }) {
  return destinationImage(params.key);
}
