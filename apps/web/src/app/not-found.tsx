import type { Metadata } from "next";
import Link from "next/link";
import { Mark } from "@/components/Mark";

export const metadata: Metadata = { title: "Not found · Pylos" };

export default function NotFound() {
  return (
    <div className="card lost">
      <Mark width={116} tight className="lost-mark" />
      <div className="head">
        <span className="eyebrow">Page not found</span>
        <h1>Blown off course</h1>
        <p className="lede">This page isn’t on the map. The link may be mistyped, or the page has moved on.</p>
      </div>
      <div className="lost-actions">
        <Link className="btn" href="/">
          Browse trips
        </Link>
        <Link className="btn ghost" href="/plan">
          Plan your own
        </Link>
      </div>
    </div>
  );
}
