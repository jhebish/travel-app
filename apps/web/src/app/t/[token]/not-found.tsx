import Link from "next/link";
import { Mark } from "@/components/Mark";

export default function SharedTripNotFound() {
  return (
    <div className="card lost">
      <Mark width={132} tight className="lost-mark" />
      <div className="head">
        <span className="eyebrow">Link turned off</span>
        <h1>This trip isn’t shared anymore</h1>
        <p className="lede">The person who shared it turned the link off, or the link was mistyped.</p>
      </div>
      <div className="lost-actions">
        <Link className="btn" href="/plan">
          Plan your own trip
        </Link>
      </div>
    </div>
  );
}
