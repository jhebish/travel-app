import type { Metadata } from "next";
import type { ReactNode } from "react";
import { linkDescription, publicCommunityTrip, tripPreview } from "@/lib/og";

// The page loads the trip in the browser; this layout only adds the link preview text (a client
// page can't export metadata). Never cached, so a trip made private drops out of previews.
export const dynamic = "force-dynamic";

type P = { params: { id: string } };

/** Preview text for public trips; anything else keeps the site defaults. The image is ./opengraph-image.tsx. */
export async function generateMetadata({ params }: P): Promise<Metadata> {
  const t = await publicCommunityTrip(params.id);
  if (!t?.itinerary) return {};
  const { title, days, detail } = tripPreview(t.destination, t.title, t.itinerary);
  const description = linkDescription(days, t.destination, detail);
  return {
    title: `${title} · Pylos`,
    description,
    openGraph: { title, description, type: "article", siteName: "Pylos" },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default function CommunityTripLayout({ children }: { children: ReactNode }) {
  return children;
}
