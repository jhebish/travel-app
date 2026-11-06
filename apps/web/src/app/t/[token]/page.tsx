import { PARTIES, TripRequestSchema, type Trip } from "@travel/core";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { TripView } from "@/components/TripView";
import { linkDescription, tripPreview } from "@/lib/og";
import { getSharedTrip } from "@/lib/share";

export const dynamic = "force-dynamic";

type P = { params: { token: string } };

/** Link preview text; the image is ./opengraph-image.tsx. */
export async function generateMetadata({ params }: P): Promise<Metadata> {
  const t = await getSharedTrip(params.token);
  if (!t) return { title: "Trip not found · Pylos" };
  const { title, days, summary } = tripPreview(t.destination, t.title, t.itinerary);
  const description = linkDescription(days, t.destination, summary);
  return {
    title: `${title} · Pylos`,
    description,
    openGraph: { title, description, type: "article", siteName: "Pylos" },
    twitter: { card: "summary_large_image", title, description },
    robots: { index: false }, // shared links are unlisted
  };
}

export default async function SharedTripPage({ params }: P) {
  const shared = await getSharedTrip(params.token);
  if (!shared) notFound();
  const party = (PARTIES as readonly string[]).includes(shared.party) ? shared.party : "Solo";
  const trip: Trip = {
    id: "",
    createdAt: shared.createdAt,
    destination: shared.destination,
    title: shared.title,
    request: TripRequestSchema.parse({ destination: shared.destination, days: shared.days, party, budget: "Mid-range", pace: "Balanced" }),
    weights: {} as Trip["weights"],
    customMix: false,
    itinerary: shared.itinerary,
    saved: false,
    rating: 0,
    votes: {},
  };
  return (
    <>
      <TripView trip={trip} readOnly />
      <aside className="cta">
        <h2>Want a trip like this?</h2>
        <p className="lede">Tell Pylos where you&apos;re going and who&apos;s coming. You&apos;ll get a plan built from places the people who live there actually go.</p>
        <Link className="btn" href="/plan">
          Plan your own trip
        </Link>
      </aside>
    </>
  );
}
