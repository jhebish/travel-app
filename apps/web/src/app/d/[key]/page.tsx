import { DESTINATION_BY_KEY } from "@travel/core";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { linkDescription } from "@/lib/og";
import DestinationTrip from "./DestinationTrip";

type P = { params: { key: string } };

/** Link preview text; the image is ./opengraph-image.tsx. */
export function generateMetadata({ params }: P): Metadata {
  const d = DESTINATION_BY_KEY[params.key];
  if (!d) return { title: "Destination not found · Pylos" };
  const title = `${d.name}: ${d.sampleDays} days, planned the local way`;
  const description = linkDescription(d.sampleDays, d.kind === "region" ? d.name : `${d.name}, ${d.country}`, d.blurb);
  return {
    title: `${title} · Pylos`,
    description,
    openGraph: { title, description, type: "article", siteName: "Pylos" },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default function Page({ params }: P) {
  if (!DESTINATION_BY_KEY[params.key]) notFound();
  return <DestinationTrip dkey={params.key} />;
}
