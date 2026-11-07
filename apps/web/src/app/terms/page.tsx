import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Terms of Service · Pylos",
  description: "The terms for using Pylos, the locals-first trip planner.",
};

const CONTACT = "team@newcenturydevelopment.com";
const UPDATED = "November 6, 2026";

export default function TermsPage() {
  return (
    <article className="card legal">
      <header className="head">
        <span className="eyebrow">Last updated {UPDATED}</span>
        <h1>Terms of Service</h1>
        <p className="lede">
          These terms are an agreement between you and Pylos for using pylos.ai and the Pylos app (the &ldquo;Service&rdquo;). By using the Service, you agree to them. Please also
          read our <Link href="/privacy">Privacy Policy</Link>.
        </p>
      </header>

      <section>
        <h2>The Service</h2>
        <p>
          Pylos suggests travel itineraries, places to stay and things to do, drawing on local recommendations and AI. You can use it as a guest or sign in to keep your trips
          across devices. You must be at least 13 years old (16 in the EEA and UK) to use it.
        </p>
      </section>

      <section>
        <h2>Plans are suggestions</h2>
        <p>
          Itineraries are generated automatically and can be wrong or out of date: places close, hours and prices change, and travel times are estimates. Check details with the
          businesses themselves before you rely on them, and use your own judgment about safety, health, visas and local laws. Pylos doesn&rsquo;t book or sell travel, and we
          aren&rsquo;t responsible for the places, hotels or services we suggest, which are run by others. Links to other sites are for convenience.
        </p>
      </section>

      <section>
        <h2>Your account and content</h2>
        <ul>
          <li>Keep access to your email secure; you&rsquo;re responsible for activity on your account.</li>
          <li>
            You own what you add, like your notes, ratings, places and trips. You let Pylos store, process and display it to run the Service, and to show it to others when you
            make it public or share it. You can delete it at any time.
          </li>
          <li>
            Anonymized and aggregated signals, like which kinds of recommendations travelers rate highly, may be used to improve Pylos for everyone. They don&rsquo;t identify you.
          </li>
        </ul>
      </section>

      <section>
        <h2>Connected accounts</h2>
        <p>
          If you connect another service, like Google Calendar, you allow Pylos to read the information described in our{" "}
          <Link href="/privacy#google">Privacy Policy</Link> for the purpose described there. Your use of that service is also governed by its own terms.
        </p>
      </section>

      <section>
        <h2>Fair use</h2>
        <p>Don&rsquo;t misuse the Service. In particular, don&rsquo;t:</p>
        <ul>
          <li>break the law, or post content that is unlawful, harassing, hateful or that infringes someone else&rsquo;s rights;</li>
          <li>try to get into accounts or systems that aren&rsquo;t yours, or interfere with how the Service runs;</li>
          <li>scrape, resell or bulk-download the Service, or use it to build a competing product;</li>
          <li>post fake reviews or recommendations, or ones you were paid for without saying so.</li>
        </ul>
        <p>We may remove content or suspend accounts that break these terms.</p>
      </section>

      <section>
        <h2>Pylos&rsquo;s rights</h2>
        <p>
          The Service, including its design, software, name and logo, belongs to Pylos and its licensors. We may change, add or remove features, or stop offering the Service,
          and will try to give notice of significant changes.
        </p>
      </section>

      <section>
        <h2>Disclaimers</h2>
        <p>
          The Service is provided &ldquo;as is&rdquo; and &ldquo;as available,&rdquo; without warranties of any kind, express or implied, including merchantability, fitness for a
          particular purpose, accuracy and non-infringement, to the fullest extent the law allows.
        </p>
      </section>

      <section>
        <h2>Limitation of liability</h2>
        <p>
          To the fullest extent the law allows, Pylos won&rsquo;t be liable for indirect, incidental, special, consequential or punitive damages, or for lost profits, data or
          travel costs, arising from your use of the Service or from places or services we suggest. Our total liability for any claim relating to the Service is limited to
          $100 or the amount you paid us in the past 12 months, whichever is greater. Some places don&rsquo;t allow these limits, so they may not apply to you.
        </p>
      </section>

      <section>
        <h2>Ending</h2>
        <p>You can stop using Pylos and ask us to delete your account at any time. We may suspend or end access if you break these terms or if we stop the Service.</p>
      </section>

      <section>
        <h2>Law and disputes</h2>
        <p>
          These terms are governed by the laws of the State of California, without regard to its conflict-of-law rules. Disputes will be resolved in the state or federal
          courts located in Los Angeles County, California, unless the law where you live gives you the right to bring a claim elsewhere.
        </p>
      </section>

      <section>
        <h2>Changes and contact</h2>
        <p>
          We may update these terms; if we do, we&rsquo;ll change the date above and tell you about significant changes. Questions:{" "}
          <a href={`mailto:${CONTACT}`}>{CONTACT}</a>.
        </p>
      </section>
    </article>
  );
}
