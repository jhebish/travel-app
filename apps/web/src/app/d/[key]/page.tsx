import { DESTINATION_BY_KEY } from "@travel/core";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import DestinationTrip from "./DestinationTrip";

type P = { params: { key: string } };

export function generateMetadata({ params }: P): Metadata {
  const d = DESTINATION_BY_KEY[params.key];
  if (!d) return { title: "Destination not found · Pylos" };
  const title = `${d.name}: a sample ${d.sampleDays}-day ${d.kind === "region" ? "route" : "itinerary"} · Pylos`;
  return {
    title,
    description: d.blurb,
    openGraph: { title, description: d.blurb, type: "article", siteName: "Pylos" },
    twitter: { card: "summary", title, description: d.blurb },
  };
}

export default function Page({ params }: P) {
  if (!DESTINATION_BY_KEY[params.key]) notFound();
  return <DestinationTrip dkey={params.key} />;
}
