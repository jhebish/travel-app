import Link from "next/link";

export default function SharedTripNotFound() {
  return (
    <div className="card">
      <h1>This trip isn&apos;t shared anymore</h1>
      <p className="lede">The person who shared it turned the link off, or the link was mistyped.</p>
      <Link className="btn" href="/plan" style={{ alignSelf: "flex-start", width: "auto" }}>
        Plan your own trip
      </Link>
    </div>
  );
}
