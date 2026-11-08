import type { Metadata } from "next";
import type { ReactNode } from "react";
import { pastTripPreview, publicPastTrip } from "@/lib/ogPages";

// The page loads the trip in the browser; this layout only adds the link preview text (a client
// page can't export metadata). Never cached, so a trip made private drops out of previews.
export const dynamic = "force-dynamic";

type P = { params: { id: string } };

/** Preview text for trips shown to everyone; anything else keeps the site defaults. The image is ./opengraph-image.tsx. */
export async function generateMetadata({ params }: P): Promise<Metadata> {
  const p = await publicPastTrip(params.id);
  if (!p) return {};
  const { title, description } = pastTripPreview(p);
  return {
    title: `${title} · Pylos`,
    description,
    openGraph: { title, description, type: "article", siteName: "Pylos" },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default function PastTripLayout({ children }: { children: ReactNode }) {
  return children;
}
