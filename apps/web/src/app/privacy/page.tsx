import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy Policy · Pylos",
  description: "What Pylos collects, how it's used, and the choices you have, including how Pylos handles Google Calendar data.",
};

const CONTACT = "team@newcenturydevelopment.com";
const UPDATED = "November 6, 2026";

export default function PrivacyPage() {
  return (
    <article className="card legal">
      <header className="head">
        <span className="eyebrow">Last updated {UPDATED}</span>
        <h1>Privacy Policy</h1>
        <p className="lede">
          Pylos (&ldquo;Pylos,&rdquo; &ldquo;we,&rdquo; &ldquo;us&rdquo;) plans trips around the places locals love. This policy explains what we collect when you use pylos.ai
          and the Pylos app, how we use it, who we share it with, and the choices you have.
        </p>
      </header>

      <section>
        <h2>What we collect</h2>
        <ul>
          <li>
            <b>Your account.</b> Your email address if you sign in with an email code or with Google, and a random guest ID if you use Pylos without signing in.
          </li>
          <li>
            <b>Trips and preferences.</b> The destinations, dates, travel party, budget, interests and notes you enter; the itineraries we build for you; and your saves,
            star ratings, thumbs and source mix.
          </li>
          <li>
            <b>Places you&rsquo;ve been.</b> Trips and places you log yourself: city, dates, favorites, ratings and notes.
          </li>
          <li>
            <b>Community.</b> Your profile name, handle and photo if you add one, the people you follow, and any trips you choose to share or make public.
          </li>
          <li>
            <b>Connected accounts, only if you connect them.</b> See <a href="#google">Google Calendar</a> below. In the phone app, if you allow it, your calendars and the
            location data in your photos are read on your phone to find past trips; only the trips found (a place and dates) are sent to Pylos. Your photos never leave your phone.
          </li>
          <li>
            <b>Basic technical data.</b> IP address, browser and device type, pages visited and error logs, kept for security and to keep Pylos working.
          </li>
        </ul>
      </section>

      <section id="google">
        <h2>Google Calendar</h2>
        <p>Connecting Google Calendar is optional. When you choose to connect it:</p>
        <ul>
          <li>
            <b>What we access.</b> Read-only access to your calendar events (the <code>calendar.readonly</code> permission). We read events from the past six years once, at
            the moment you connect: each event&rsquo;s title, location, notes and dates.
          </li>
          <li>
            <b>What we use it for.</b> Only to find trips you&rsquo;ve taken and places you&rsquo;ve been, such as hotel stays, flights and restaurant reservations, so we can learn your
            taste and plan trips you&rsquo;ll like. Nothing else.
          </li>
          <li>
            <b>What we keep.</b> Only the trips and places we find: a place name, city, date and the kind of booking (for example, &ldquo;OpenTable reservation&rdquo;). We do not
            store your calendar events, and we never write to or change your calendar.
          </li>
          <li>
            <b>How long we have access.</b> We give the access back to Google as soon as the read finishes, so Pylos has no ongoing access to your calendar. You can also see and
            remove apps with access in your <a href="https://myaccount.google.com/permissions">Google Account settings</a>.
          </li>
          <li>
            <b>Sharing.</b> We don&rsquo;t sell Google user data or use it for advertising. The places we find are used to personalize your plans, which includes sending them to
            our AI provider (see below) when it builds your itinerary. We don&rsquo;t use Google user data to develop, improve or train generalized AI or machine learning models,
            and our AI provider doesn&rsquo;t train on it. No person at Pylos reads your Google data unless you ask us to, it&rsquo;s needed for security, or the law requires it.
          </li>
          <li>
            <b>Deleting it.</b> You can remove imported places from your profile at any time, or ask us to delete everything (see below).
          </li>
        </ul>
        <p className="callout">
          Pylos&rsquo;s use and transfer to any other app of information received from Google APIs will adhere to the{" "}
          <a href="https://developers.google.com/terms/api-services-user-data-policy">Google API Services User Data Policy</a>, including the Limited Use requirements.
        </p>
      </section>

      <section>
        <h2>How we use your information</h2>
        <ul>
          <li>To build and improve your itineraries, including learning your taste from the places you&rsquo;ve been and how you rated them.</li>
          <li>To run the community features you choose to use, like following friends and sharing trips.</li>
          <li>To keep Pylos secure, prevent abuse and fix problems.</li>
          <li>To answer you when you contact us.</li>
        </ul>
        <p>We don&rsquo;t sell your personal information, and we don&rsquo;t use it for advertising.</p>
      </section>

      <section>
        <h2>Who we share it with</h2>
        <ul>
          <li>
            <b>Service providers that run Pylos for us</b>, under contracts that limit their use of your data: Supabase (database and sign-in), Vercel (hosting), Anthropic (the
            AI model that drafts itineraries from your request, preferences and travel history), Google Maps Platform (checking places and showing their photos) and Typeform (if you
            use the step-by-step trip form).
          </li>
          <li>
            <b>Other people, when you choose.</b> Public profiles and public trips can be seen by anyone; trips shown to followers are seen by your followers; and a shared trip
            link can be opened by anyone who has it. You can change a trip&rsquo;s visibility or turn its link off at any time.
          </li>
          <li>
            <b>When the law requires it</b>, or to protect the rights, property or safety of our users, the public or Pylos.
          </li>
          <li>
            <b>If Pylos changes hands</b>, as part of a merger or sale, under this policy.
          </li>
        </ul>
      </section>

      <section>
        <h2>Keeping and deleting your data</h2>
        <p>
          We keep your information while your account is active. You can delete trips and remove logged or imported places at any time. To delete your account and everything
          linked to it, email <a href={`mailto:${CONTACT}`}>{CONTACT}</a> from the address you sign in with; we&rsquo;ll delete it within 30 days, except where the law requires us
          to keep something.
        </p>
      </section>

      <section>
        <h2>Your rights</h2>
        <p>
          Depending on where you live (for example, under the GDPR in Europe or the CCPA in California), you may have the right to access, correct, delete or download your
          information, and to object to or limit how we use it. Email <a href={`mailto:${CONTACT}`}>{CONTACT}</a> and we&rsquo;ll respond within 30 days. We won&rsquo;t treat you
          differently for using these rights.
        </p>
      </section>

      <section>
        <h2>Security</h2>
        <p>
          We encrypt data in transit, limit who can access it, and keep sign-in tokens in your device&rsquo;s secure storage in the phone app. No service is perfectly secure, but
          we work to protect your information and will tell you if a breach affects you.
        </p>
      </section>

      <section>
        <h2>Children</h2>
        <p>Pylos isn&rsquo;t meant for children under 13 (or under 16 in the EEA and UK), and we don&rsquo;t knowingly collect their information.</p>
      </section>

      <section>
        <h2>Where we process data</h2>
        <p>Pylos is based in the United States, and your information may be processed there and in other countries where our providers operate.</p>
      </section>

      <section>
        <h2>Changes</h2>
        <p>If we change this policy, we&rsquo;ll update the date at the top, and tell you in the app or by email if the change is significant.</p>
      </section>

      <section>
        <h2>Contact</h2>
        <p>
          Questions or requests: <a href={`mailto:${CONTACT}`}>{CONTACT}</a>. See also our <Link href="/terms">Terms of Service</Link>.
        </p>
      </section>
    </article>
  );
}
