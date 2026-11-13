import type { Metadata } from "next";
import Link from "next/link";
import { Mark } from "@/components/Mark";

export const metadata: Metadata = {
  title: "About · Pylos",
  description: "Pylos plans trips around the places locals love: day-by-day itineraries, places to stay, and recommendations that learn your taste.",
};

export default function AboutPage() {
  return (
    <article className="card legal about">
      <header className="head">
        <Mark width={84} tight className="card-mark" />
        <h1>Trips planned the local way</h1>
        <p className="lede">
          Pylos builds day-by-day itineraries around the cafés, restaurants, neighborhoods and places to stay that locals actually recommend, then learns your taste so every
          trip fits you better.
        </p>
      </header>

      <section>
        <h2>What Pylos does</h2>
        <ul>
          <li>
            <b>Plans your trip.</b> Tell us where, when, who&rsquo;s coming and your budget. Pylos plans each day in walkable neighborhoods, with times, local tips and a map, and
            suggests places to stay nearby. Every place is checked against Google Maps.
          </li>
          <li>
            <b>Routes through a country.</b> For longer trips, it picks the stops, the order and how long to stay, choosing places that are good in the month you travel.
          </li>
          <li>
            <b>Lets you shape it.</b> Swap a stop, rebuild a day, lock the places you love, rate the trip, and plan together with friends.
          </li>
          <li>
            <b>Learns your taste.</b> Log places you&rsquo;ve been and what you loved, and Pylos favors places with the same feel on your next trips.
          </li>
        </ul>
      </section>

      <section>
        <h2>Connecting Google Calendar (optional)</h2>
        <p>
          Instead of logging past trips by hand, you can connect Google Calendar from your profile. Pylos asks Google for read-only access, reads your past events once to find
          trips you&rsquo;ve taken (hotel stays, flights, restaurant reservations), keeps only the places and dates it finds, and gives the access straight back. It never changes
          your calendar. Those places are used only to learn your taste and personalize your plans. Details are in our <Link href="/privacy#google">Privacy Policy</Link>.
        </p>
      </section>

      <section>
        <h2>Get started</h2>
        <p>
          <Link href="/">Browse trending trips</Link> or <Link href="/plan">plan your own</Link>. No account needed; sign in with your email or Google any time to keep your trips
          across devices.
        </p>
        <p>
          Questions: <a href="mailto:team@newcenturydevelopment.com">team@newcenturydevelopment.com</a> · <Link href="/privacy">Privacy Policy</Link> ·{" "}
          <Link href="/terms">Terms of Service</Link>
        </p>
      </section>
    </article>
  );
}
