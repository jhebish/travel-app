import { PARTIES, TripRequestSchema, type Trip } from "@travel/core";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { TripView } from "@/components/TripView";
import { getSharedTrip } from "@/lib/share";

export const dynamic = "force-dynamic";

type P = { params: { token: string } };

export async function generateMetadata({ params }: P): Promise<Metadata> {
  const t = await getSharedTrip(params.token);
  if (!t) return { title: "Trip not found · Pylos" };
  const description = t.itinerary.summary.slice(0, 200);
  return {
    title: `${t.title} · Pylos`,
    description,
    openGraph: { title: t.title, description, type: "article", siteName: "Pylos" },
    twitter: { card: "summary", title: t.title, description },
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
        <Link className="btn" href="/">
          Plan your own trip
        </Link>
      </aside>
    </>
  );
}
